/*
 * Simple web server to control the C ambilight program.
 *
 * - starts / stops the ambilight binary
 * - forwards every setting change as UDP message "{name}: {value}" to port 9000
 *
 * Run (needs root, because the ambilight binary needs root for the LEDs):
 *   sudo node server.js
 *
 * Environment variables:
 *   PORT           web server port (default 3000)
 *   AMBILIGHT_BIN  path to the compiled ambilight program
 *   UDP_HOST       receiver of the UDP messages (default 127.0.0.1)
 *   SETTINGS_FILE  file the settings are saved in (default settings.json next to this file)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const { spawn } = require("child_process");

/*************** Configuration ****************************************************************/
const PORT = Number(process.env.PORT) || 5000;
const UDP_HOST = process.env.UDP_HOST || "127.0.0.1";
const UDP_PORT = 9000;
const AMBILIGHT_BIN = process.env.AMBILIGHT_BIN
    || path.join(__dirname, "..", "C", "ambilight");
const PUBLIC_DIR = path.join(__dirname, "public");
const STOP_TIMEOUT_MS = 3000;
const LOG_LINES = 200;    // how many output lines are kept for newly opened pages
const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(__dirname, "settings.json");
const SAVE_DELAY_MS = 1000;   // slider moves are collected and saved together
const STARTED_LINE = "Started";   // ambilight.c prints this after its UDP socket is ready

// allowed settings with their range, start values are the constants from ambilight.c
// (brightness, smooth_ratio and dark_gamma in percent)
const SETTINGS = {
    brightness:      { min: 0, max: 100, integer: true,  value: 70 },
    smooth_ratio:    { min: 0, max: 100, integer: true,  value: 85 },
    dark_gamma:      { min: 0, max: 100, integer: true,  value: 20 },
    resize_size:     { min: 1, max: 100, integer: true,  value: 18 },
    distance_left:   { min: 0, max: 100, integer: true,  value: 1 },
    distance_top:    { min: 0, max: 100, integer: true,  value: 1 },
    distance_right:  { min: 0, max: 100, integer: true,  value: 1 },
    distance_bottom: { min: 0, max: 100, integer: true,  value: 1 },
};

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

/*************** Log ***************************************************************************/
const logEntries = [];        // last LOG_LINES entries { id, time, stream, line }
const logClients = new Set(); // open log streams of web pages (Server-Sent Events)
let logId = 0;

// stream: "stdout" / "stderr" = output of ambilight.c, "server" = message of this server
function log(line, stream) {
    const entry = { id: ++logId, time: Date.now(), stream, line };
    const prefix = stream === "server" ? "" : "[ambilight] ";
    (stream === "stderr" ? process.stderr : process.stdout).write(`${prefix}${line}\n`);

    logEntries.push(entry);
    if (logEntries.length > LOG_LINES)
        logEntries.shift();
    for (const res of logClients)
        writeLogEntry(res, entry);
}

function writeLogEntry(res, entry) {
    res.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`);
}

// splits the output of the program into lines, a chunk can end in the middle of a line;
// onLine (optional) is called with every complete line
function logLines(readable, stream, onLine = () => {}) {
    let rest = "";
    readable.setEncoding("utf8");
    readable.on("data", (chunk) => {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop();
        for (const line of lines) {
            log(line.replace(/\r$/, ""), stream);
            onLine(line);
        }
    });
    readable.on("end", () => {
        if (rest) {
            log(rest, stream);
            onLine(rest);
        }
    });
}

/*************** Ambilight Process ************************************************************/
let ambilight = null;     // running child process or null
let message = "Aus";      // last status text for the web page

function startAmbilight() {
    return new Promise((resolve) => {
        if (ambilight)
            return resolve();

        // printf() only writes full buffers into a pipe, stdbuf -oL makes it write every line at once
        const [command, args] = process.platform === "linux" ? ["stdbuf", ["-oL", AMBILIGHT_BIN]] : [AMBILIGHT_BIN, []];
        const proc = spawn(command, args, { cwd: path.dirname(AMBILIGHT_BIN), stdio: ["ignore", "pipe", "pipe"] });
        ambilight = proc;
        message = "Läuft";

        // UDP messages sent before the program has bound its socket would be lost,
        // so all settings are sent once it reports that it has started
        let settingsSent = false;
        logLines(proc.stdout, "stdout", (line) => {
            if (settingsSent || !line.startsWith(STARTED_LINE))
                return;
            settingsSent = true;
            sendAllSettings().catch((err) => log(`Einstellungen nicht gesendet: ${err.message}`, "server"));
        });
        logLines(proc.stderr, "stderr");
        proc.on("spawn", () => {
            log(`Ambilight gestartet (PID ${proc.pid})`, "server");
            resolve();
        });
        proc.on("error", (err) => {
            log(`Ambilight konnte nicht gestartet werden: ${err.message}`, "server");
            message = `Fehler: ${err.message}`;
            if (ambilight === proc)
                ambilight = null;
            resolve();
        });
        proc.on("exit", (code, signal) => {
            log(`Ambilight beendet (Code ${code}, Signal ${signal})`, "server");
            if (ambilight === proc) {
                ambilight = null;
                message = signal === "SIGTERM" || code === 0 ? "Aus" : `Beendet mit Fehlercode ${code}`;
            }
        });
    });
}

// SIGTERM lets ambilight.c leave its loop and switch the LEDs off
function stopAmbilight() {
    return new Promise((resolve) => {
        const proc = ambilight;
        if (!proc)
            return resolve();

        const timer = setTimeout(() => {
            log("Ambilight reagiert nicht, sende SIGKILL", "server");
            proc.kill("SIGKILL");
        }, STOP_TIMEOUT_MS);
        proc.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
        proc.kill("SIGTERM");
    });
}

/*************** UDP **************************************************************************/
const udp = dgram.createSocket("udp4");

function sendSetting(name, value) {
    return new Promise((resolve, reject) => {
        const text = `${name}: ${value}`;
        udp.send(Buffer.from(text), UDP_PORT, UDP_HOST, (err) => {
            if (err)
                return reject(err);
            console.log(`UDP -> ${UDP_HOST}:${UDP_PORT}  ${text}`);
            resolve();
        });
    });
}

// checks name and value, returns the normalized value or throws an error with a message
function validateSetting(name, value) {
    const setting = Object.hasOwn(SETTINGS, name) ? SETTINGS[name] : null;
    if (!setting)
        throw new Error(`Unbekannte Einstellung: ${name}`);

    const number = Number(value);
    if (typeof value === "boolean" || value === null || value === "" || !Number.isFinite(number))
        throw new Error(`${name} muss eine Zahl sein`);
    if (setting.integer && !Number.isInteger(number))
        throw new Error(`${name} muss eine ganze Zahl sein`);
    if (number < setting.min || number > setting.max)
        throw new Error(`${name} muss zwischen ${setting.min} und ${setting.max} liegen`);

    return setting.integer ? number : Math.round(number * 100) / 100;
}

// in the order of SETTINGS, so resize_size arrives before the distances
async function sendAllSettings() {
    for (const [name, setting] of Object.entries(SETTINGS))
        await sendSetting(name, setting.value);
}

/*************** Settings File ****************************************************************/
function currentSettings() {
    const settings = {};
    for (const [name, setting] of Object.entries(SETTINGS))
        settings[name] = setting.value;
    return settings;
}

// saved values replace the start values, unknown or invalid ones are ignored
function loadSettings() {
    let saved;
    try {
        saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch (err) {
        if (err.code !== "ENOENT")
            log(`Einstellungen konnten nicht geladen werden: ${err.message}`, "server");
        return;
    }
    for (const [name, value] of Object.entries(saved)) {
        try {
            SETTINGS[name].value = validateSetting(name, value);
        } catch (err) {
            log(`Gespeicherter Wert ignoriert: ${err.message}`, "server");
        }
    }
    log(`Einstellungen geladen aus ${SETTINGS_FILE}`, "server");
}

let saveTimer = null;

function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeSettings, SAVE_DELAY_MS);
}

// writes into a temporary file first, so a power cut never leaves a half written settings.json
function writeSettings() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const tmp = `${SETTINGS_FILE}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(currentSettings(), null, 4) + "\n");
        fs.renameSync(tmp, SETTINGS_FILE);
    } catch (err) {
        log(`Einstellungen konnten nicht gespeichert werden: ${err.message}`, "server");
    }
}

/*************** HTTP *************************************************************************/
function sendJson(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 10000)
                req.destroy(new Error("Anfrage zu groß"));
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("Ungültiges JSON"));
            }
        });
        req.on("error", reject);
    });
}

function state() {
    return { running: ambilight !== null, message, settings: currentSettings() };
}

function serveFile(res, file) {
    fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
        if (err)
            return sendJson(res, 404, { error: "Nicht gefunden" });
        res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(data);
    });
}

async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const route = `${req.method} ${url.pathname}`;

    try {
        switch (route) {
            case "GET /":
                res.writeHead(302, { Location: "/ambilight" });
                return res.end();
            case "GET /ambilight":
                return serveFile(res, "ambilight.html");
            case "GET /style.css":
                return serveFile(res, "style.css");
            case "GET /ambilight.js":
                return serveFile(res, "ambilight.js");

            case "GET /api/ambilight":
                return sendJson(res, 200, state());

            // live output of ambilight.c as Server-Sent Events, starts with the last LOG_LINES lines
            // (after a reconnect only the lines the page has not seen yet)
            case "GET /api/ambilight/log": {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                const lastId = Number(req.headers["last-event-id"]) || 0;
                const seenBefore = lastId <= logId;   // otherwise the server was restarted
                for (const entry of logEntries)
                    if (!seenBefore || entry.id > lastId)
                        writeLogEntry(res, entry);
                logClients.add(res);
                req.on("close", () => logClients.delete(res));
                return;
            }

            case "POST /api/ambilight/power": {
                const { on } = await readJson(req);
                if (typeof on !== "boolean")
                    return sendJson(res, 400, { error: "on muss true oder false sein" });
                await (on ? startAmbilight() : stopAmbilight());
                return sendJson(res, 200, state());
            }

            case "POST /api/ambilight/setting": {
                const { name, value } = await readJson(req);
                let normalized;
                try {
                    normalized = validateSetting(name, value);
                } catch (err) {
                    return sendJson(res, 400, { error: err.message });
                }
                SETTINGS[name].value = normalized;
                saveSettings();
                await sendSetting(name, normalized);
                return sendJson(res, 200, { name, value: normalized });
            }

            default:
                return sendJson(res, 404, { error: "Nicht gefunden" });
        }
    } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: err.message });
    }
}

/*************** Main *************************************************************************/
loadSettings();

const server = http.createServer(handle);
server.listen(PORT, () => {
    console.log(`Webserver läuft auf http://localhost:${PORT}`);
    console.log(`Ambilight-Programm: ${AMBILIGHT_BIN}`);
    console.log(`UDP-Nachrichten an ${UDP_HOST}:${UDP_PORT}`);
});

// switch the LEDs off when the web server is stopped
async function shutdown() {
    if (saveTimer)
        writeSettings();
    await stopAmbilight();
    udp.close();
    server.close();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
