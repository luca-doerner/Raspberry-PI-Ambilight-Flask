const STATUS_POLL_MS = 2000;
const SLIDER_SEND_MS = 100;

const statusEl = document.getElementById("status");
const powerEl = document.getElementById("power");
const errorEl = document.getElementById("error");
const settingEls = document.querySelectorAll("[data-setting]");

let powerBusy = false;
const errors = new Map();   // error message per source ("power" or setting name)

/*************** Helper Functions *************************************************************/
async function api(url, body) {
    const options = body === undefined ? {} : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(data.error || res.statusText);
    return data;
}

// sets or clears (empty message) the error of one source and shows all remaining errors
function showError(source, message) {
    if (message)
        errors.set(source, message);
    else
        errors.delete(source);
    errorEl.textContent = [...errors.values()].join("\n");
    errorEl.hidden = errors.size === 0;
}

// calls fn at most every ms milliseconds, always with the latest arguments
function throttle(fn, ms) {
    let timer = null;
    let lastArgs;
    return (...args) => {
        lastArgs = args;
        if (!timer)
            timer = setTimeout(() => {
                timer = null;
                fn(...lastArgs);
            }, ms);
    };
}

/*************** Power ************************************************************************/
function showState(state) {
    powerEl.checked = state.running;
    powerEl.disabled = false;
    statusEl.textContent = state.message;
    statusEl.classList.toggle("on", state.running);
}

powerEl.addEventListener("change", async () => {
    powerBusy = true;
    powerEl.disabled = true;
    statusEl.textContent = powerEl.checked ? "Starte …" : "Stoppe …";
    try {
        showState(await api("/api/ambilight/power", { on: powerEl.checked }));
        showError("power", "");
    } catch (err) {
        showError("power", `Ein-/Ausschalten fehlgeschlagen: ${err.message}`);
        powerEl.checked = !powerEl.checked;
        powerEl.disabled = false;
    } finally {
        powerBusy = false;
    }
});

// the program can also stop by itself (e.g. no HDMI signal), so the state is polled
async function pollState() {
    if (powerBusy)
        return;
    try {
        showState(await api("/api/ambilight"));
    } catch {
        statusEl.textContent = "Server nicht erreichbar";
        statusEl.classList.remove("on");
    }
}

/*************** Settings *********************************************************************/
// value of an input as it is sent to the server (sliders are sent as percent 0-100)
function inputValue(el) {
    return Number(el.value);
}

function showInputValue(el, value) {
    el.value = value;
    updateOutput(el);
}

function updateOutput(el) {
    const output = document.querySelector(`output[for="${el.id}"]`);
    if (output)
        output.textContent = `${el.value} %`;
}

async function sendSetting(el) {
    if (!el.checkValidity()) {
        showError(el.dataset.setting, `${el.labels[0].textContent}: ${el.validationMessage}`);
        return;
    }
    try {
        await api("/api/ambilight/setting", { name: el.dataset.setting, value: inputValue(el) });
        showError(el.dataset.setting, "");
    } catch (err) {
        showError(el.dataset.setting, `Einstellung nicht gesendet: ${err.message}`);
    }
}

for (const el of settingEls) {
    if (el.type === "range") {
        const send = throttle(() => sendSetting(el), SLIDER_SEND_MS);
        el.addEventListener("input", () => {
            updateOutput(el);
            send();
        });
    } else {
        el.addEventListener("change", () => sendSetting(el));
    }
}

/*************** Log **************************************************************************/
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
}

/*************** Start ************************************************************************/
async function init() {
    try {
        const state = await api("/api/ambilight");
        showState(state);
        for (const el of settingEls)
            showInputValue(el, state.settings[el.dataset.setting]);
    } catch (err) {
        showError("server", `Server nicht erreichbar: ${err.message}`);
    }
    setInterval(pollState, STATUS_POLL_MS);
    openLog();
}

init();
