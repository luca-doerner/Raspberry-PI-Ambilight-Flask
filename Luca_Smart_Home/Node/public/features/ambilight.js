// panel of the feature "ambilight": switch, status and the settings of the C program
import { api, el, errorBox, throttle, toggleSwitch } from "../lib.js";

const STATUS_POLL_MS = 2000;
const SLIDER_SEND_MS = 100;

function statusText(state) {
    if (state.running)
        return "Läuft";
    if (!state.active)
        return "Aus";
    return state.message === "Aus" ? "Starte …" : `Aktiv, Programm läuft nicht: ${state.message}`;
}

function slider(name, label, value, send) {
    const id = `setting-${name}`;
    const output = el("output", { for: id }, `${value} %`);
    const input = el("input", { type: "range", id, min: 0, max: 100, step: 1, value });
    input.addEventListener("input", () => {
        output.textContent = `${input.value} %`;
        send(name, input);
    });
    return el("div", { class: "range" }, el("label", { for: id }, label), input, output);
}

function numberField(name, label, value, min, send, extraClass = "") {
    const id = `setting-${name}`;
    const input = el("input", { type: "number", id, min, max: 100, step: 1, value });
    input.addEventListener("change", () => send(name, input));
    return el("div", { class: `field ${extraClass}` }, el("label", { for: id }, label), input);
}

// shows the output of ambilight.c in the browser console (F12), reconnects by itself
function openLog() {
    const source = new EventSource("/api/ambilight/log");
    source.addEventListener("message", (event) => {
        const { time, stream, line } = JSON.parse(event.data);
        const text = `[${stream === "server" ? "server" : "ambilight"} ${new Date(time).toLocaleTimeString()}] ${line}`;
        if (stream === "stderr")
            console.error(text);
        else
            console.log(text);
    });
    return source;
}

// container: element to render into; feature: from /api/features/:id;
// onFeaturesChanged: called after switching, other exclusive features may have been switched off
export async function renderAmbilight(container, feature, { onFeaturesChanged }) {
    const errors = errorBox();
    let state = await api("/api/ambilight");

    if (state.featureId !== feature.id) {
        container.append(el("section", { class: "card" },
            el("h2", {}, feature.name),
            el("p", { class: "muted" }, state.featureId === null
                ? "Der Server hat noch kein Ambilight-Feature aus der Datenbank geladen."
                : `Der Server steuert ein anderes Ambilight-Feature (id ${state.featureId}). `
                  + "Mit AMBILIGHT_FEATURE_ID kann man festlegen, welches gesteuert wird.")));
        return () => {};
    }

    /* power */
    const status = el("p", { class: "status" });
    const power = toggleSwitch({
        label: `${feature.name} ein/aus`,
        checked: state.active,
        async onToggle(active) {
            status.textContent = active ? "Starte …" : "Stoppe …";
            try {
                await api(`/api/features/${feature.id}/active`, { active });
                errors.show("power", "");
                onFeaturesChanged();
            } catch (err) {
                errors.show("power", `Ein-/Ausschalten fehlgeschlagen: ${err.message}`);
                throw err;
            } finally {
                await poll();
            }
        },
    });

    function showState() {
        if (!power.input.disabled)
            power.input.checked = state.active;
        status.textContent = statusText(state);
        status.classList.toggle("on", state.running);
    }

    // the program can also stop by itself (e.g. no HDMI signal), so the state is polled
    async function poll() {
        try {
            state = await api("/api/ambilight");
            showState();
        } catch {
            status.textContent = "Server nicht erreichbar";
            status.classList.remove("on");
        }
    }

    /* settings */
    async function sendSetting(name, input) {
        if (!input.checkValidity()) {
            errors.show(name, `${input.labels[0].textContent}: ${input.validationMessage}`);
            return;
        }
        try {
            await api("/api/ambilight/setting", { name, value: Number(input.value) });
            errors.show(name, "");
        } catch (err) {
            errors.show(name, `Einstellung nicht gesendet: ${err.message}`);
        }
    }
    // one throttle per slider, so moving two sliders quickly sends both
    const throttled = {};
    const sendSlider = (name, input) => {
        throttled[name] ??= throttle(sendSetting, SLIDER_SEND_MS);
        throttled[name](name, input);
    };

    const s = state.settings;
    container.append(
        el("section", { class: "card power" },
            el("div", {}, el("h2", {}, feature.name), status),
            power.node),
        el("section", { class: "card" },
            el("h3", {}, "Farbe"),
            slider("brightness", "Helligkeit", s.brightness, sendSlider),
            slider("smooth_ratio", "Glättung", s.smooth_ratio, sendSlider),
            slider("dark_gamma", "Dark Gamma", s.dark_gamma, sendSlider)),
        el("section", { class: "card" },
            el("h3", {}, "Abtastung"),
            numberField("resize_size", "Resize Size", s.resize_size, 1, sendSetting),
            el("h4", {}, "Abstand zum Bildrand"),
            el("div", { class: "screen-layout" },
                numberField("distance_top", "Oben", s.distance_top, 0, sendSetting, "distance top"),
                numberField("distance_left", "Links", s.distance_left, 0, sendSetting, "distance left"),
                el("div", { class: "screen", "aria-hidden": "true" }, "Bild"),
                numberField("distance_right", "Rechts", s.distance_right, 0, sendSetting, "distance right"),
                numberField("distance_bottom", "Unten", s.distance_bottom, 0, sendSetting, "distance bottom"))),
        errors.node);
    showState();

    const timer = setInterval(poll, STATUS_POLL_MS);
    const log = openLog();
    return () => {
        clearInterval(timer);
        log.close();
    };
}
