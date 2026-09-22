// Runs the programs of the features, depending on their kind (table feature_kinds):
//
//   service  runs until it is stopped (start / stop buttons, remembered in features.active);
//            gets all settings as --name=value when it starts; settings without restart_required
//            go to it via UDP ("name: value") when they change and after it printed "Started ...";
//            saving a changed setting with restart_required restarts it
//   oneshot  runs once every time settings are saved, with all settings as --name=value;
//            an exclusive oneshot stops the exclusive services of its device before it runs
//
// Both also get the settings of their device (device_setting_definitions) as --name=value;
// changing a device setting restarts the running services of the device.
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
// a setting with this name is switched off when an exclusive service of the device starts
const POWER_SETTING = "power";

// state of the programs that are not in the database, per feature id
const runtimes = new Map();

function runtime(id) {
    if (!runtimes.has(id))
        runtimes.set(id, { proc: null, starting: null, message: "Aus", lastRun: null });
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

// the name / value pairs a setting stands for: normally one, a "screen" setting becomes four
// (distance -> distance_top, distance_left, distance_right, distance_bottom)
function settingPairs(definition, value) {
    if (definition.type !== "screen")
        return [[definition.name, value]];
    return smarthome.SCREEN_SIDES.map((side) => [`${definition.name}_${side}`, value[side]]);
}

// every start (service and oneshot): all device settings, then all feature settings (also those
// with restart_required); if both have the same name, both are passed and the feature value comes
// last, so a program that takes the last one uses the feature value
async function commandLine(feature) {
    const deviceSettings = await smarthome.loadSettings("device", feature.device_id);
    return [...deviceSettings, ...feature.settings]
        .flatMap((setting) => settingPairs(setting, setting.value))
        .map(([name, value]) => `--${name}=${formatValue(value)}`);
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

// one message per name / value pair, a "screen" setting therefore sends four
async function sendUdpSetting(feature, definition, value) {
    for (const [name, sideValue] of settingPairs(definition, value))
        await sendUdp(feature, name, sideValue);
}

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
            await sendUdpSetting(feature, setting, setting.value);
}

/*************** Service **********************************************************************/
// a second start while the first one still loads from the database waits for the first one,
// so the program never runs twice
function startService(id) {
    const rt = runtime(id);
    if (rt.proc)
        return Promise.resolve();
    rt.starting ??= spawnService(id, rt).finally(() => {
        rt.starting = null;
    });
    return rt.starting;
}

async function spawnService(id, rt) {
    const feature = await smarthome.getFeature(id);
    let program;
    try {
        program = programOf(feature);
    } catch (err) {
        rt.message = `Fehler: ${err.message}`;
        log(err.message, "server", feature);
        return;
    }
    const args = await commandLine(feature);

    await new Promise((resolve) => {
        const child = spawnProgram(program, args);
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

// the value that means "off" for a setting: false, the option "off" or the text "off"
function offValue(definition) {
    if (definition.type === "boolean")
        return false;
    const option = (definition.options ?? []).find((o) => String(o.value).toLowerCase() === "off");
    if (option)
        return option.value;
    return definition.type === "text" ? "off" : null;
}

// an exclusive service takes over the device: the exclusive oneshots of the device that have a
// setting named "power" are switched off, so the page shows what really is on
async function switchOffExclusiveOneshots(feature) {
    for (const oneshot of await smarthome.exclusiveOneshots(feature.device_id, feature.id)) {
        const settings = await smarthome.loadSettings("feature", oneshot.id);
        const power = settings.find((setting) => setting.name === POWER_SETTING);
        const off = power && offValue(power);
        if (off === null || off === undefined || JSON.stringify(power.value) === JSON.stringify(off))
            continue;
        await smarthome.saveSettingValues("feature", oneshot.id, { [POWER_SETTING]: off });
        log(`${oneshot.name}: ${POWER_SETTING} auf ${formatValue(off)} gesetzt, weil ${feature.name} gestartet wurde`,
            "server", oneshot);
    }
}

// called after features.active changed (smarthome.setFeatureActive)
async function setActive(id, active) {
    if (!active)
        return stopProgram(id);
    await startService(id);
    const feature = await smarthome.getFeature(id);
    if (feature.exclusive)
        await switchOffExclusiveOneshots(feature);
}

/*************** Oneshot **********************************************************************/
async function runOnce(id) {
    const rt = runtime(id);
    if (rt.proc)
        throw new HttpError(409, "Das Programm läuft noch, bitte kurz warten");
    const feature = await smarthome.getFeature(id);
    const program = programOf(feature);
    const args = await commandLine(feature);
    const start = Date.now();

    return new Promise((resolve) => {
        const child = spawnProgram(program, args);
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
    const feature = await smarthome.getFeature(id);
    const normalized = smarthome.validateValues(feature.settings, values);
    if (Object.keys(normalized).length === 0 && feature.kind !== "oneshot")
        throw new HttpError(400, "Keine Einstellungen angegeben");
    // checked before anything is saved or stopped
    if (feature.kind === "oneshot" && runtime(id).proc !== null)
        throw new HttpError(409, "Das Programm läuft noch, bitte kurz warten");
    const definitions = new Map(feature.settings.map((setting) => [setting.name, setting]));

    if (Object.keys(normalized).length > 0)
        await smarthome.saveSettingValues("feature", id, normalized);
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
                    await sendUdpSetting(feature, definitions.get(name), value);
        }
    } else if (feature.kind === "oneshot") {
        if (feature.exclusive)
            result.stopped = await stopExclusiveServices(feature);
        result.run = await runOnce(id);
    }
    return result;
}

// saves device settings; if a value changed, the running services of the device are restarted,
// so they get the new values on the command line; returns { values, restarted: [names] }
async function applyDeviceSettings(deviceId, values) {
    const { settings, services } = await smarthome.getDeviceSettings(deviceId);
    const normalized = smarthome.validateValues(settings, values);
    if (Object.keys(normalized).length === 0)
        throw new HttpError(400, "Keine Einstellungen angegeben");
    const changed = settings.some((setting) =>
        Object.hasOwn(normalized, setting.name) && JSON.stringify(setting.value) !== JSON.stringify(normalized[setting.name]));
    await smarthome.saveSettingValues("device", deviceId, normalized);

    const restarted = [];
    if (changed) {
        for (const service of services) {
            if (runtime(service.id).proc === null)
                continue;
            log(`${service.name} wird neu gestartet, weil sich Geräte-Einstellungen geändert haben`, "server", service);
            await stopProgram(service.id);
            await startService(service.id);
            restarted.push(service.name);
        }
    }
    return { values: normalized, restarted };
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

module.exports = { init, setActive, applySettings, applyDeviceSettings, state, shutdown };
