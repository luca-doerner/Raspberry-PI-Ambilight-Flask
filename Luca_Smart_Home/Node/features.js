// Runs the programs of the features, depending on their kind (table feature_kinds):
//
//   service  runs until it is stopped (start / stop buttons, remembered in features.active);
//            gets all settings as --name=value when it starts; settings without restart_required
//            go to it via UDP ("name: value") when they change and after it printed "Started ...";
//            saving a changed setting with restart_required restarts it
//   oneshot  runs once every time settings are saved, with all settings as --name=value;
//            an exclusive oneshot stops the exclusive services of its device before it runs
//
// A new kind needs a row in feature_kinds and a branch in applySettings (and maybe start / stop).
const path = require("path");
const dgram = require("dgram");
const { spawn } = require("child_process");
const HttpError = require("./http-error");
const { log, logLines } = require("./log");
const smarthome = require("./smarthome");

const PROJECT_DIR = path.join(__dirname, "..");   // Luca_Smart_Home/, executables are relative to it
const UDP_HOST = process.env.UDP_HOST || "127.0.0.1";
const STARTED_LINE = "Started";   // a service prints this when its UDP socket is ready
const STOP_TIMEOUT_MS = 3000;
const ONESHOT_TIMEOUT_MS = 60000;
const OUTPUT_LIMIT = 20000;       // characters of the output of a oneshot run kept for the page
const DB_RETRY_MS = 5000;

// state of the programs that are not in the database, per feature id
const runtimes = new Map();

function runtime(id) {
    if (!runtimes.has(id))
        runtimes.set(id, { proc: null, message: "Aus", lastRun: null });
    return runtimes.get(id);
}

/*************** Program **********************************************************************/
function programOf(feature) {
    if (!feature.executable)
        throw new HttpError(400, `Für „${feature.name}“ ist kein Programm (features.executable) eingetragen`);
    return path.resolve(PROJECT_DIR, feature.executable);
}

// numbers and booleans as JSON (70, 0.5, true), texts as they are
function formatValue(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
}

function commandLine(feature) {
    return feature.settings.map((setting) => `--${setting.name}=${formatValue(setting.value)}`);
}

// printf() only writes full buffers into a pipe, stdbuf -oL makes the program write every line at once
function spawnProgram(program, args) {
    const [command, commandArgs] = process.platform === "linux"
        ? ["stdbuf", ["-oL", program, ...args]]
        : [program, args];
    return spawn(command, commandArgs, { cwd: path.dirname(program), stdio: ["ignore", "pipe", "pipe"] });
}

/*************** UDP **************************************************************************/
let udp = null;

function sendUdp(feature, name, value) {
    if (!feature.udp_port)
        return Promise.resolve();
    udp ??= dgram.createSocket("udp4");
    return new Promise((resolve, reject) => {
        const text = `${name}: ${formatValue(value)}`;
        udp.send(Buffer.from(text), feature.udp_port, UDP_HOST, (err) => {
            if (err)
                return reject(err);
            console.log(`UDP -> ${UDP_HOST}:${feature.udp_port}  ${text}`);
            resolve();
        });
    });
}

// in sort_order, e.g. ambilight gets resize_size before the distances
async function sendLiveSettings(feature) {
    for (const setting of feature.settings)
        if (!setting.restart_required)
            await sendUdp(feature, setting.name, setting.value);
}

/*************** Service **********************************************************************/
async function startService(id) {
    const rt = runtime(id);
    if (rt.proc)
        return;
    const feature = await smarthome.getFeature(id);
    let program;
    try {
        program = programOf(feature);
    } catch (err) {
        rt.message = `Fehler: ${err.message}`;
        log(err.message, "server", feature);
        return;
    }

    await new Promise((resolve) => {
        const child = spawnProgram(program, commandLine(feature));
        rt.proc = child;
        rt.message = "Läuft";

        // UDP messages sent before the program has bound its socket would be lost, so the
        // settings are sent once it reports that it has started (loaded again, they may have changed)
        let started = false;
        logLines(child.stdout, "stdout", feature, (line) => {
            if (started || !line.startsWith(STARTED_LINE))
                return;
            started = true;
            smarthome.getFeature(id).then(sendLiveSettings)
                .catch((err) => log(`Einstellungen nicht gesendet: ${err.message}`, "server", feature));
        });
        logLines(child.stderr, "stderr", feature);
        child.on("spawn", () => {
            log(`${feature.name} gestartet (PID ${child.pid})`, "server", feature);
            resolve();
        });
        child.on("error", (err) => {
            log(`${feature.name} konnte nicht gestartet werden: ${err.message}`, "server", feature);
            rt.message = `Fehler: ${err.message}`;
            if (rt.proc === child)
                rt.proc = null;
            resolve();
        });
        child.on("exit", (code, signal) => {
            log(`${feature.name} beendet (Code ${code}, Signal ${signal})`, "server", feature);
            if (rt.proc === child) {
                rt.proc = null;
                rt.message = signal === "SIGTERM" || code === 0 ? "Aus" : `Beendet mit Fehlercode ${code}`;
            }
        });
    });
}

// SIGTERM lets the program clean up (ambilight.c switches the LEDs off), SIGKILL if it hangs
function stopProgram(id) {
    return new Promise((resolve) => {
        const child = runtime(id).proc;
        if (!child)
            return resolve();
        const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill("SIGTERM");
    });
}

// called after features.active changed (smarthome.setFeatureActive)
async function setActive(id, active) {
    await (active ? startService(id) : stopProgram(id));
}

/*************** Oneshot **********************************************************************/
async function runOnce(id) {
    const rt = runtime(id);
    if (rt.proc)
        throw new HttpError(409, "Das Programm läuft noch, bitte kurz warten");
    const feature = await smarthome.getFeature(id);
    const program = programOf(feature);
    const start = Date.now();

    return new Promise((resolve) => {
        const child = spawnProgram(program, commandLine(feature));
        rt.proc = child;
        rt.message = "Läuft";
        log(`${feature.name} ausgeführt`, "server", feature);

        let output = "";
        const collect = (line) => {
            if (output.length < OUTPUT_LIMIT)
                output += `${line}\n`;
        };
        logLines(child.stdout, "stdout", feature, collect);
        logLines(child.stderr, "stderr", feature, collect);

        const timer = setTimeout(() => {
            log(`${feature.name} läuft länger als ${ONESHOT_TIMEOUT_MS / 1000} s, wird abgebrochen`, "server", feature);
            child.kill("SIGKILL");
        }, ONESHOT_TIMEOUT_MS);

        let done = false;
        const finish = (exitCode, error) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            if (rt.proc === child)
                rt.proc = null;
            rt.lastRun = { time: start, durationMs: Date.now() - start, exitCode, error, output: output.slice(0, OUTPUT_LIMIT) };
            rt.message = error ? `Fehler: ${error}` : exitCode === 0 ? "Erfolgreich ausgeführt" : `Beendet mit Fehlercode ${exitCode}`;
            log(`${feature.name}: ${rt.message}`, "server", feature);
            resolve(rt.lastRun);
        };
        child.on("error", (err) => finish(null, err.message));
        // "close" instead of "exit": all output has been read by then
        child.on("close", (code, signal) => finish(code, signal ? `abgebrochen (${signal})` : null));
    });
}

/*************** Settings *********************************************************************/
// an exclusive oneshot takes over the device: stops its exclusive services (for good, they do not
// start again with the server); returns the names of the services that were started before
async function stopExclusiveServices(feature) {
    const stopped = [];
    for (const service of await smarthome.stopExclusiveServices(feature.device_id, feature.id)) {
        if (!service.active && runtime(service.id).proc === null)
            continue;
        await stopProgram(service.id);
        log(`${service.name} gestoppt, weil ${feature.name} ausgeführt wird`, "server", service);
        stopped.push(service.name);
    }
    return stopped;
}

// saves settings from the web page and applies them depending on the kind of the feature;
// a oneshot can also be run again without changes (empty values);
// returns { values, restarted, run, stopped }
async function applySettings(id, values) {
    if (values === null || typeof values !== "object" || Array.isArray(values))
        throw new HttpError(400, "values muss ein Objekt sein");
    const feature = await smarthome.getFeature(id);
    if (Object.keys(values).length === 0 && feature.kind !== "oneshot")
        throw new HttpError(400, "Keine Einstellungen angegeben");
    // checked before anything is saved or stopped
    if (feature.kind === "oneshot" && runtime(id).proc !== null)
        throw new HttpError(409, "Das Programm läuft noch, bitte kurz warten");
    const definitions = new Map(feature.settings.map((setting) => [setting.name, setting]));

    const normalized = {};
    for (const [name, value] of Object.entries(values)) {
        const definition = definitions.get(name);
        if (!definition)
            throw new HttpError(400, `Unbekannte Einstellung: ${name}`);
        normalized[name] = smarthome.validateValue(definition, value);
    }
    if (Object.keys(normalized).length > 0)
        await smarthome.saveSettingValues(id, normalized);
    const result = { values: normalized, restarted: false, run: null, stopped: [] };

    if (feature.kind === "service") {
        const running = runtime(id).proc !== null;
        const restartNeeded = Object.entries(normalized).some(([name, value]) =>
            definitions.get(name).restart_required && JSON.stringify(definitions.get(name).value) !== JSON.stringify(value));
        if (running && restartNeeded) {
            await stopProgram(id);
            await startService(id);
            result.restarted = true;
        } else if (running) {
            for (const [name, value] of Object.entries(normalized))
                if (!definitions.get(name).restart_required)
                    await sendUdp(feature, name, value);
        }
    } else if (feature.kind === "oneshot") {
        if (feature.exclusive)
            result.stopped = await stopExclusiveServices(feature);
        result.run = await runOnce(id);
    }
    return result;
}

/*************** State ************************************************************************/
function state(id) {
    const rt = runtime(id);
    return { running: rt.proc !== null, message: rt.message, lastRun: rt.lastRun };
}

// starts the services that were running before the server stopped;
// tries again until the database is reachable (PostgreSQL may start after this server)
async function init() {
    try {
        const ids = await smarthome.activeServices();
        for (const id of ids)
            await startService(id);
        log(`${ids.length} Dienst(e) gestartet`);
    } catch (err) {
        log(`Dienste nicht gestartet, neuer Versuch in ${DB_RETRY_MS / 1000} s: ${err.message}`);
        setTimeout(init, DB_RETRY_MS);
    }
}

// stops all programs, the services stay active in the database and start again with the server
async function shutdown() {
    await Promise.all([...runtimes.keys()].map(stopProgram));
    udp?.close();
}

module.exports = { init, setActive, applySettings, state, shutdown };
