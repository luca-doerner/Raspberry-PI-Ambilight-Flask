// Panel of a feature, built only from its setting definitions (table setting_definitions),
// depending on its kind:
//   service  start / stop, settings are applied at once, settings with restart_required are saved
//            with a button and restart the running service
//   oneshot  all settings in a form, saving runs the program; shows the result of the last run
import { api, el, errorBox, throttle } from "./lib.js";

const STATUS_POLL_MS = 2000;
const LIVE_SEND_MS = 100;   // sliders and color pickers send at most this often while moving

const KIND_LABELS = { service: "Dienst", oneshot: "Einmalig" };

/*************** Setting Inputs ***************************************************************/
// append that also takes lists and leaves out empty parts (null)
function appendAll(container, ...parts) {
    container.append(...parts.flat(Infinity).filter((part) => part !== null && part !== undefined));
}

function formatValue(setting, value) {
    return setting.unit ? `${value} ${setting.unit}` : String(value);
}

// input for one setting: { node, read(), write(value), focusTarget }
// onInput: while the value changes (sliders, colors), onChange: when the change is finished
function settingInput(setting, id, { onInput = () => {}, onChange = () => {} }) {
    const numeric = { min: setting.min ?? undefined, max: setting.max ?? undefined, step: setting.step ?? 1 };
    switch (setting.type) {
        case "range": {
            const input = el("input", { type: "range", id, ...numeric, value: setting.value });
            const output = el("output", { for: id }, formatValue(setting, setting.value));
            input.addEventListener("input", () => {
                output.textContent = formatValue(setting, input.value);
                onInput();
            });
            input.addEventListener("change", onChange);
            return {
                node: el("div", { class: "range-control" }, input, output),
                read: () => Number(input.value),
                write: (value) => {
                    input.value = value;
                    output.textContent = formatValue(setting, value);
                },
                input,
            };
        }
        case "number": {
            const input = el("input", { type: "number", id, ...numeric, value: setting.value });
            input.addEventListener("change", onChange);
            return {
                node: el("div", { class: "number-control" }, input, setting.unit ? el("span", { class: "unit" }, setting.unit) : null),
                read: () => (input.value === "" ? NaN : Number(input.value)),
                write: (value) => { input.value = value; },
                input,
            };
        }
        case "boolean": {
            const input = el("input", { type: "checkbox", role: "switch", id, checked: setting.value });
            input.addEventListener("change", onChange);
            return {
                node: el("label", { class: "switch" }, input, el("span", { class: "track" }, el("span", { class: "thumb" }))),
                read: () => input.checked,
                write: (value) => { input.checked = value; },
                input,
            };
        }
        case "select": {
            // option values can be numbers or texts, the <option> only keeps the index
            const index = setting.options.findIndex((o) => JSON.stringify(o.value) === JSON.stringify(setting.value));
            const input = el("select", { id }, setting.options.map((option, i) =>
                el("option", { value: i, selected: i === index }, option.label)));
            input.addEventListener("change", onChange);
            return {
                node: input,
                read: () => setting.options[Number(input.value)]?.value,
                write: (value) => {
                    input.value = setting.options.findIndex((o) => JSON.stringify(o.value) === JSON.stringify(value));
                },
                input,
            };
        }
        case "button_select": {
            // one button per option, like a button slicer; works like radio buttons: click or
            // arrow keys select, only the selected button is in the tab order
            const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            let value = setting.value;
            const buttons = setting.options.map((option) => el("button", {
                type: "button", class: "choice", role: "radio",
            }, option.label));
            const group = el("div", { class: "button-select", role: "radiogroup", id, "aria-labelledby": `${id}-label` }, buttons);

            const show = () => buttons.forEach((button, i) => {
                const selected = same(setting.options[i].value, value);
                button.setAttribute("aria-checked", String(selected));
                button.tabIndex = selected || (i === 0 && !setting.options.some((o) => same(o.value, value))) ? 0 : -1;
            });
            const select = (i) => {
                if (same(setting.options[i].value, value))
                    return;
                value = setting.options[i].value;
                show();
                buttons[i].focus();
                group.dispatchEvent(new Event("input"));   // the form notices the change
                onChange();
            };
            buttons.forEach((button, i) => {
                button.addEventListener("click", () => select(i));
                button.addEventListener("keydown", (event) => {
                    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
                    if (step) {
                        event.preventDefault();
                        select((i + step + buttons.length) % buttons.length);
                    }
                });
            });
            show();

            // the group is used like an <input> by the forms: it is always valid
            group.checkValidity = () => true;
            group.reportValidity = () => true;
            return {
                node: group,
                read: () => value,
                write: (newValue) => {
                    value = newValue;
                    show();
                },
                input: group,
            };
        }
        case "screen": {
            // four numbers around a screen, e.g. the distance of the ambilight LEDs to the edges
            const sides = [["top", "Oben"], ["left", "Links"], ["right", "Rechts"], ["bottom", "Unten"]];
            const inputs = {};
            const fields = sides.map(([side, label]) => {
                const sideId = `${id}-${side}`;
                inputs[side] = el("input", { type: "number", id: sideId, ...numeric, value: setting.value[side] });
                inputs[side].addEventListener("change", onChange);
                return el("div", { class: `screen-field ${side}` },
                    el("label", { for: sideId }, label), inputs[side]);
            });
            // the input events of the four fields bubble up to the group, that is how a form notices changes
            const group = el("div", { class: "screen-layout", role: "group", id, "aria-labelledby": `${id}-label` },
                fields, el("div", { class: "screen", "aria-hidden": "true" }, "Bild"));

            const all = () => Object.values(inputs);
            group.checkValidity = () => all().every((input) => input.checkValidity());
            group.reportValidity = () => all().find((input) => !input.checkValidity())?.reportValidity() ?? true;
            Object.defineProperty(group, "validationMessage", {
                get: () => all().find((input) => !input.checkValidity())?.validationMessage ?? "",
            });
            return {
                node: group,
                read: () => Object.fromEntries(sides.map(([side]) =>
                    [side, inputs[side].value === "" ? NaN : Number(inputs[side].value)])),
                write: (value) => {
                    for (const [side] of sides)
                        inputs[side].value = value[side];
                },
                input: group,
            };
        }
        case "color": {
            const input = el("input", { type: "color", id, value: setting.value });
            // der Hex-Code daneben zeigt die Farbe und kann auch eingetippt werden
            const hex = el("input", {
                type: "text", class: "color-hex", value: setting.value, maxlength: 7, size: 7,
                spellcheck: "false", autocapitalize: "none",
                "aria-label": `${setting.label} als Hexadezimalcode`,
            });

            input.addEventListener("input", () => {
                hex.value = input.value;
                onInput();
            });
            input.addEventListener("change", onChange);
            hex.addEventListener("change", () => {
                // "ff8800" und "#FF8800" sind auch in Ordnung
                const text = hex.value.trim().replace(/^#?/, "#").toLowerCase();
                if (!/^#[0-9a-f]{6}$/.test(text)) {
                    hex.value = input.value;   // ungültig: zurück auf die aktuelle Farbe
                    return;
                }
                hex.value = text;
                if (text !== input.value) {
                    input.value = text;
                    onChange();
                }
            });

            return {
                node: el("div", { class: "color-control" }, input, hex),
                read: () => input.value,
                write: (value) => {
                    input.value = value;
                    hex.value = value;
                },
                input,
            };
        }
        default: {   // "text"
            const input = el("input", { type: "text", id, maxlength: 1000, value: setting.value });
            input.addEventListener("change", onChange);
            return { node: input, read: () => input.value, write: (value) => { input.value = value; }, input };
        }
    }
}

function settingRow(setting, id, control) {
    return el("div", { class: "setting-row" },
        el("label", { for: id, id: `${id}-label` }, setting.label),
        control.node);
}

// [[section, settings], ...] in the order of the settings, settings without section under fallback
function bySection(settings, fallback) {
    const sections = new Map();
    for (const setting of settings) {
        const section = setting.section ?? fallback;
        if (!sections.has(section))
            sections.set(section, []);
        sections.get(section).push(setting);
    }
    return [...sections];
}

/*************** Saving *********************************************************************/
async function saveSettings(feature, values) {
    return api(`/api/features/${feature.id}/settings`, { values });
}

// form of settings that are saved together with a button, also used for the device settings;
// idPrefix: makes the ids of the inputs unique on the page; save(values): sends the changed values
// and returns the answer of the server; onSaved(result, status) is called with that answer
export function settingsForm(settings, { idPrefix, save, title, description, submitLabel, alwaysSubmit, errors, onSaved }) {
    const controls = new Map();
    const saved = new Map(settings.map((s) => [s.name, s.value]));
    const status = el("p", { class: "form-status muted", role: "status" });
    const button = el("button", { class: "button primary", type: "submit" }, submitLabel);

    const changedValues = () => {
        const values = {};
        for (const [name, control] of controls)
            if (JSON.stringify(control.read()) !== JSON.stringify(saved.get(name)))
                values[name] = control.read();
        return values;
    };
    const updateButton = () => {
        const changed = Object.keys(changedValues()).length > 0;
        button.disabled = !alwaysSubmit && !changed;
        status.textContent = changed ? "Ungespeicherte Änderungen" : "";
    };

    const sections = bySection(settings, null).map(([section, list]) => [
        section ? el("h4", {}, section) : null,
        list.map((setting) => {
            const id = `${idPrefix}-${setting.name}`;
            const control = settingInput(setting, id, { onInput: updateButton, onChange: updateButton });
            control.input.addEventListener("input", updateButton);
            controls.set(setting.name, control);
            return settingRow(setting, id, control);
        }),
    ]);

    const form = el("form", { class: "card settings-form" },
        el("h3", {}, title),
        description ? el("p", { class: "muted form-description" }, description) : null,
        sections,
        el("div", { class: "form-actions" }, button, status));

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const invalid = [...controls.values()].find((control) => !control.input.checkValidity());
        if (invalid) {
            invalid.input.reportValidity();
            return;
        }
        const values = changedValues();
        button.disabled = true;
        status.textContent = "Speichere …";
        try {
            const result = await save(values);
            for (const [name, value] of Object.entries(result.values)) {
                saved.set(name, value);
                controls.get(name).write(value);
            }
            errors.show("form", "");
            updateButton();
            onSaved(result, status);
        } catch (err) {
            errors.show("form", `Speichern fehlgeschlagen: ${err.message}`);
            updateButton();
        }
    });
    updateButton();
    return form;
}

/*************** Service ********************************************************************/
function serviceStatusText(state) {
    if (state.running)
        return "Läuft";
    if (!state.active)
        return state.message === "Aus" ? "Gestoppt" : state.message;
    return state.message === "Aus" ? "Starte …" : `Gestartet, Programm läuft nicht: ${state.message}`;
}

function renderService(container, feature, { onFeaturesChanged }) {
    const errors = errorBox();
    let state = { active: feature.active, ...feature.state };

    /* header with start / stop */
    const status = el("p", { class: "status" });
    const startButton = el("button", { class: "button primary", type: "button" }, "Start");
    const stopButton = el("button", { class: "button", type: "button" }, "Stopp");
    let busy = false;

    function showState() {
        status.textContent = serviceStatusText(state);
        status.classList.toggle("on", state.running);
        startButton.disabled = busy || (state.active && state.running);
        stopButton.disabled = busy || (!state.active && !state.running);
    }

    async function poll() {
        try {
            const before = [state.active, state.running];
            state = await api(`/api/features/${feature.id}/state`);
            showState();
            // e.g. the program crashed: the dot in the tab changes at once
            if (before[0] !== state.active || before[1] !== state.running)
                onFeaturesChanged();
        } catch {
            status.textContent = "Server nicht erreichbar";
            status.classList.remove("on");
        }
    }

    async function setActive(active) {
        busy = true;
        showState();
        status.textContent = active ? "Starte …" : "Stoppe …";
        try {
            ({ state } = await api(`/api/features/${feature.id}/active`, { active }));
            errors.show("power", "");
            onFeaturesChanged();
        } catch (err) {
            errors.show("power", `${active ? "Starten" : "Stoppen"} fehlgeschlagen: ${err.message}`);
        } finally {
            busy = false;
            showState();
        }
    }
    startButton.addEventListener("click", () => setActive(true));
    stopButton.addEventListener("click", () => setActive(false));

    /* settings that are applied at once */
    const live = feature.settings.filter((s) => !s.restart_required);
    const sendLive = async (name, value) => {
        try {
            await saveSettings(feature, { [name]: value });
            errors.show(name, "");
        } catch (err) {
            errors.show(name, err.message);
        }
    };
    const liveCards = bySection(live, "Einstellungen").map(([section, list]) => el("section", { class: "card" },
        el("h3", {}, section),
        list.map((setting) => {
            const id = `setting-${feature.id}-${setting.name}`;
            const throttled = throttle(sendLive, LIVE_SEND_MS);
            let control;
            const send = (sender) => () => {
                if (!control.input.checkValidity())
                    return errors.show(setting.name, `${setting.label}: ${control.input.validationMessage}`);
                sender(setting.name, control.read());
            };
            // sliders and colors send while moving (throttled), the others when the change is done
            const moving = setting.type === "range" || setting.type === "color";
            control = settingInput(setting, id, {
                onInput: moving ? send(throttled) : () => {},
                onChange: moving ? () => {} : send(sendLive),
            });
            return settingRow(setting, id, control);
        })));

    /* settings that need a restart */
    const restart = feature.settings.filter((s) => s.restart_required);
    const restartForm = restart.length === 0 ? null : settingsForm(restart, {
        idPrefix: `setting-${feature.id}`,
        save: (values) => saveSettings(feature, values),
        title: "Einstellungen mit Neustart",
        description: "Werden erst mit „Speichern“ übernommen. Läuft der Dienst, wird er dafür neu gestartet.",
        submitLabel: "Speichern",
        errors,
        onSaved(result, formStatus) {
            formStatus.textContent = result.restarted ? "Gespeichert, Dienst wurde neu gestartet" : "Gespeichert";
            if (result.state) {
                state = result.state;
                showState();
            }
        },
    });

    appendAll(container,
        el("section", { class: "card power" },
            el("div", {},
                el("h2", {}, feature.name, " ", el("span", { class: "badge" }, KIND_LABELS.service)),
                status,
                feature.hasProgram ? null : el("p", { class: "muted" }, "Für dieses Feature ist kein Programm eingetragen.")),
            el("div", { class: "header-actions" }, startButton, stopButton)),
        liveCards,
        restartForm,
        errors.node);
    showState();

    const timer = setInterval(poll, STATUS_POLL_MS);
    return () => clearInterval(timer);
}

/*************** Oneshot ********************************************************************/
function runResult(run) {
    if (!run)
        return el("p", { class: "muted" }, "Seit dem Start des Servers noch nicht ausgeführt.");
    const ok = !run.error && run.exitCode === 0;
    const summary = run.error ? `Fehler: ${run.error}` : ok ? "Erfolgreich" : `Fehlercode ${run.exitCode}`;
    return [
        el("p", { class: `status${ok ? " on" : " failed"}` },
            `${summary} · ${new Date(run.time).toLocaleTimeString()} · ${(run.durationMs / 1000).toFixed(1)} s`),
        run.output ? el("pre", { class: "output" }, run.output) : el("p", { class: "muted" }, "Keine Ausgabe."),
    ];
}

function renderOneshot(container, feature, { onFeaturesChanged }) {
    const errors = errorBox();
    const result = el("section", { class: "card" }, el("h3", {}, "Letzte Ausführung"), runResult(feature.state.lastRun));

    const form = settingsForm(feature.settings, {
        idPrefix: `setting-${feature.id}`,
        save: (values) => saveSettings(feature, values),
        title: "Einstellungen",
        description: ["„Speichern und ausführen“ speichert die Einstellungen und startet das Programm einmal "
            + "mit allen Einstellungen und den Geräte-Einstellungen als ", el("code", {}, "--name=wert"), "."],
        submitLabel: "Speichern und ausführen",
        alwaysSubmit: true,
        errors,
        onSaved(saved, formStatus) {
            const stopped = saved.stopped.length > 0 ? ` (gestoppt: ${saved.stopped.join(", ")})` : "";
            formStatus.textContent = (saved.run?.exitCode === 0 ? "Gespeichert und ausgeführt" : "Gespeichert, Ausführung fehlgeschlagen") + stopped;
            result.replaceChildren(el("h3", {}, "Letzte Ausführung"), ...[runResult(saved.run)].flat());
            if (saved.stopped.length > 0)
                onFeaturesChanged();   // the dots of the stopped services
        },
    });

    appendAll(container,
        el("section", { class: "card" },
            el("h2", {}, feature.name, " ", el("span", { class: "badge" }, KIND_LABELS.oneshot)),
            el("p", { class: "muted" }, "Läuft einmal, wenn die Einstellungen gespeichert werden."
                + (feature.exclusive ? " Stoppt vorher die exklusiven Dienste dieses Geräts." : "")),
            feature.hasProgram ? null : el("p", { class: "muted" }, "Für dieses Feature ist kein Programm eingetragen.")),
        form,
        result,
        errors.node);
    return () => {};
}

/*************** Panel **********************************************************************/
// shows the output of the program of the feature in the browser console (F12)
function openLog(feature) {
    const source = new EventSource("/api/log");
    source.addEventListener("message", (event) => {
        const { time, stream, featureId, line } = JSON.parse(event.data);
        if (featureId !== feature.id)
            return;
        const text = `[${feature.name} ${new Date(time).toLocaleTimeString()}] ${line}`;
        (stream === "stderr" ? console.error : console.log)(text);
    });
    return source;
}

// container: element to render into; feature: from /api/features/:id;
// onFeaturesChanged: called after start / stop, other exclusive features may have been stopped
export function renderFeature(container, feature, { onFeaturesChanged }) {
    let cleanup;
    if (feature.kind === "service")
        cleanup = renderService(container, feature, { onFeaturesChanged });
    else if (feature.kind === "oneshot")
        cleanup = renderOneshot(container, feature, { onFeaturesChanged });
    else {
        container.append(el("section", { class: "card" },
            el("h2", {}, feature.name),
            el("p", { class: "muted" }, `Die Art „${feature.kind}“ kennt diese Seite noch nicht.`)));
        cleanup = () => {};
    }
    const log = openLog(feature);
    return () => {
        cleanup();
        log.close();
    };
}
