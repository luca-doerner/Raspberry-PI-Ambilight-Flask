// Feature "ambilight": starts / stops the C program (C/ambilight.c), saves its settings in the
// database and forwards every setting as UDP message "{name}: {value}" to port 9000.
const path = require("path");
const dgram = require("dgram");
const { spawn } = require("child_process");
const db = require("./db");
const HttpError = require("./http-error");
const { log, logLines } = require("./log");

/*************** Configuration ****************************************************************/
const UDP_HOST = process.env.UDP_HOST || "127.0.0.1";
const UDP_PORT = 9000;
const PROJECT_DIR = path.join(__dirname, "..");   // Luca_Smart_Home/
const FEATURE_TYPE = "ambilight";
const FEATURE_ID = Number(process.env.AMBILIGHT_FEATURE_ID) || null;
const STOP_TIMEOUT_MS = 3000;
const SAVE_DELAY_MS = 1000;   // slider moves are collected and saved together
const DB_RETRY_MS = 5000;     // wait time before the database is tried again
const STARTED_LINE = "Started";   // ambilight.c prints this after its UDP socket is ready

let ambilightBin = process.env.AMBILIGHT_BIN || path.join(PROJECT_DIR, "C", "ambilight");

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

/*************** Process **********************************************************************/
let proc = null;          // running child process or null
let message = "Aus";      // last status text for the web page
let featureId = null;     // id of the ambilight feature, set once it is loaded from the database
let active = false;       // the feature is switched on (features.active)

function start() {
    return new Promise((resolve) => {
        if (proc)
            return resolve();

        // printf() only writes full buffers into a pipe, stdbuf -oL makes it write every line at once
        const [command, args] = process.platform === "linux" ? ["stdbuf", ["-oL", ambilightBin]] : [ambilightBin, []];
        const child = spawn(command, args, { cwd: path.dirname(ambilightBin), stdio: ["ignore", "pipe", "pipe"] });
        proc = child;
        message = "Läuft";

        // UDP messages sent before the program has bound its socket would be lost,
        // so all settings are sent once it reports that it has started
        let settingsSent = false;
        logLines(child.stdout, "stdout", (line) => {
            if (settingsSent || !line.startsWith(STARTED_LINE))
                return;
            settingsSent = true;
            sendAllSettings().catch((err) => log(`Einstellungen nicht gesendet: ${err.message}`));
        });
        logLines(child.stderr, "stderr");
        child.on("spawn", () => {
            log(`Ambilight gestartet (PID ${child.pid})`);
            resolve();
        });
        child.on("error", (err) => {
            log(`Ambilight konnte nicht gestartet werden: ${err.message}`);
            message = `Fehler: ${err.message}`;
            if (proc === child)
                proc = null;
            resolve();
        });
        child.on("exit", (code, signal) => {
            log(`Ambilight beendet (Code ${code}, Signal ${signal})`);
            if (proc === child) {
                proc = null;
                message = signal === "SIGTERM" || code === 0 ? "Aus" : `Beendet mit Fehlercode ${code}`;
            }
        });
    });
}

// SIGTERM lets ambilight.c leave its loop and switch the LEDs off
function stop() {
    return new Promise((resolve) => {
        const child = proc;
        if (!child)
            return resolve();

        const timer = setTimeout(() => {
            log("Ambilight reagiert nicht, sende SIGKILL");
            child.kill("SIGKILL");
        }, STOP_TIMEOUT_MS);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill("SIGTERM");
    });
}

// called when features.active of an ambilight feature changed
async function setActive(id, isActive) {
    if (id !== featureId) {
        log(`Ambilight-Feature ${id} wird von diesem Server nicht gesteuert (gesteuert wird ${featureId})`);
        return;
    }
    active = isActive;
    await (isActive ? start() : stop());
}

function state() {
    return { featureId, active, running: proc !== null, message, settings: currentSettings() };
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

// in the order of SETTINGS, so resize_size arrives before the distances
async function sendAllSettings() {
    for (const [name, setting] of Object.entries(SETTINGS))
        await sendSetting(name, setting.value);
}

/*************** Settings *********************************************************************/
const dirty = new Set();      // names of settings that were changed but are not saved yet
let saveTimer = null;

function currentSettings() {
    const settings = {};
    for (const [name, setting] of Object.entries(SETTINGS))
        settings[name] = setting.value;
    return settings;
}

// checks name and value, returns the normalized value or throws an HttpError
function validateSetting(name, value) {
    const setting = Object.hasOwn(SETTINGS, name) ? SETTINGS[name] : null;
    if (!setting)
        throw new HttpError(400, `Unbekannte Einstellung: ${name}`);

    const number = Number(value);
    if (typeof value === "boolean" || value === null || value === "" || !Number.isFinite(number))
        throw new HttpError(400, `${name} muss eine Zahl sein`);
    if (setting.integer && !Number.isInteger(number))
        throw new HttpError(400, `${name} muss eine ganze Zahl sein`);
    if (number < setting.min || number > setting.max)
        throw new HttpError(400, `${name} muss zwischen ${setting.min} und ${setting.max} liegen`);

    return setting.integer ? number : Math.round(number * 100) / 100;
}

// changes a setting from the web page: remember, save later, send to the program
async function setSetting(name, value) {
    const normalized = validateSetting(name, value);
    SETTINGS[name].value = normalized;
    dirty.add(name);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeSettings, SAVE_DELAY_MS);
    await sendSetting(name, normalized);
    return normalized;
}

// the ambilight feature: AMBILIGHT_FEATURE_ID or the only feature of type "ambilight"
async function findFeature() {
    const { rows } = FEATURE_ID
        ? await db.query("SELECT id, name, executable, active FROM features WHERE id = $1 AND type = $2", [FEATURE_ID, FEATURE_TYPE])
        : await db.query("SELECT id, name, executable, active FROM features WHERE type = $1 ORDER BY id", [FEATURE_TYPE]);
    if (rows.length === 0)
        throw new Error(FEATURE_ID
            ? `kein Feature mit id ${FEATURE_ID} vom Typ "${FEATURE_TYPE}"`
            : `kein Feature vom Typ "${FEATURE_TYPE}" (Database/seed.sql ausführen)`);
    if (rows.length > 1)
        log(`Mehrere Features vom Typ "${FEATURE_TYPE}", nehme id ${rows[0].id} (AMBILIGHT_FEATURE_ID setzen)`);
    return rows[0];
}

// loads the feature and its settings, saved values replace the start values, unknown or invalid
// ones are ignored; tries again until the database is reachable (PostgreSQL may start after this
// server); if the feature was active before the server stopped, the program is started again
async function init() {
    try {
        const feature = await findFeature();
        if (!process.env.AMBILIGHT_BIN && feature.executable)
            ambilightBin = path.resolve(PROJECT_DIR, feature.executable);

        const { rows } = await db.query("SELECT name, value FROM settings WHERE feature_id = $1", [feature.id]);
        for (const { name, value } of rows) {
            if (dirty.has(name))   // changed on the web page while the database was unreachable
                continue;
            try {
                SETTINGS[name].value = validateSetting(name, value);
            } catch (err) {
                log(`Gespeicherter Wert ignoriert: ${err.message}`);
            }
        }
        featureId = feature.id;
        active = feature.active;
        log(`Ambilight-Feature "${feature.name}" (id ${feature.id}) geladen (${rows.length} Einstellungen, `
            + `${active ? "aktiv" : "nicht aktiv"}), Programm: ${ambilightBin}`);

        if (dirty.size > 0)
            writeSettings();
        if (active)
            await start();
        else if (proc)
            sendAllSettings().catch((err) => log(`Einstellungen nicht gesendet: ${err.message}`));
    } catch (err) {
        log(`Ambilight-Feature nicht geladen, neuer Versuch in ${DB_RETRY_MS / 1000} s: ${err.message}`);
        setTimeout(init, DB_RETRY_MS);
    }
}

// only changed settings are written, so saved values that could not be loaded yet are never
// overwritten with start values; before loading, the changes are kept until init saves them
async function writeSettings() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (featureId === null || dirty.size === 0)
        return;

    const names = [...dirty];
    dirty.clear();
    try {
        await db.query(`
            INSERT INTO settings (feature_id, name, value)
            SELECT $1, name, to_jsonb(value) FROM unnest($2::text[], $3::double precision[]) AS s (name, value)
            ON CONFLICT (feature_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            [featureId, names, names.map((name) => SETTINGS[name].value)]);
    } catch (err) {
        for (const name of names)
            dirty.add(name);
        log(`Einstellungen nicht gespeichert, neuer Versuch in ${DB_RETRY_MS / 1000} s: ${err.message}`);
        saveTimer = setTimeout(writeSettings, DB_RETRY_MS);
    }
}

// saves open changes and stops the program (LEDs off), the feature stays active in the database
async function shutdown() {
    await writeSettings();
    await stop();
    udp.close();
}

module.exports = {
    FEATURE_TYPE,
    init,
    setActive,
    setSetting,
    shutdown,
    state,
    featureId: () => featureId,
    binary: () => ambilightBin,
};
