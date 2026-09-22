// Rooms, devices (nested), features and their settings from the database (Database/schema.sql).
const db = require("./db");
const HttpError = require("./http-error");

// rooms with all their devices as a tree, for the navigation:
// [{ id, name, devices: [{ id, name, type, children: [...] }] }]
async function getTree() {
    const { rows: rooms } = await db.query("SELECT id, name FROM rooms ORDER BY name");
    const { rows: devices } = await db.query(
        "SELECT id, name, type, room_id, parent_device_id FROM devices ORDER BY name");

    const nodes = new Map(devices.map((d) => [d.id, { id: d.id, name: d.name, type: d.type, children: [] }]));
    const roomNodes = new Map(rooms.map((r) => [r.id, { id: r.id, name: r.name, devices: [] }]));
    for (const d of devices) {
        if (d.room_id !== null)
            roomNodes.get(d.room_id).devices.push(nodes.get(d.id));
        else
            nodes.get(d.parent_device_id).children.push(nodes.get(d.id));
    }
    return [...roomNodes.values()];
}

// pinned devices in the order they were pinned, location: room / parent devices, e.g. "Wohnzimmer / Fernseher"
async function getPinned() {
    const { rows } = await db.query(`
        SELECT v.id, v.name, v.type, COALESCE(p.path, r.name) AS location
        FROM devices_with_room v
        JOIN devices d ON d.id = v.id
        LEFT JOIN devices_with_room p ON p.id = v.parent_device_id
        LEFT JOIN rooms r ON r.id = d.room_id
        WHERE d.pinned_at IS NOT NULL
        ORDER BY d.pinned_at`);
    return rows;
}

async function setDevicePinned(id, pinned) {
    const { rows: [device] } = await db.query(`
        UPDATE devices SET pinned_at = CASE WHEN $2 THEN COALESCE(pinned_at, now()) END
        WHERE id = $1
        RETURNING pinned_at IS NOT NULL AS pinned`, [id, pinned]);
    if (!device)
        throw new HttpError(404, "Gerät nicht gefunden");
    return device.pinned;
}

// the devices directly in a room or directly plugged into a device, with counts for the cards
async function listDevices(column, id) {
    const { rows } = await db.query(`
        SELECT d.id, d.name, d.type,
               (SELECT count(*)::int FROM devices c WHERE c.parent_device_id = d.id) AS child_count,
               (SELECT count(*)::int FROM features f WHERE f.device_id = d.id) AS feature_count
        FROM devices d
        WHERE d.${column} = $1
        ORDER BY d.name`, [id]);
    return rows;
}

async function getRoom(id) {
    const { rows: [room] } = await db.query("SELECT id, name FROM rooms WHERE id = $1", [id]);
    if (!room)
        throw new HttpError(404, "Zimmer nicht gefunden");
    return { ...room, devices: await listDevices("room_id", id) };
}

// device with its path from the room ([room, device, ..., this device]), its parent,
// its child devices and its features
async function getDevice(id) {
    const { rows: chain } = await db.query(`
        WITH RECURSIVE up AS (
            SELECT id, name, type, room_id, parent_device_id, pinned_at, 0 AS depth FROM devices WHERE id = $1
            UNION ALL
            SELECT d.id, d.name, d.type, d.room_id, d.parent_device_id, d.pinned_at, up.depth + 1
            FROM devices d JOIN up ON d.id = up.parent_device_id
        )
        SELECT up.*, r.name AS room_name FROM up LEFT JOIN rooms r ON r.id = up.room_id
        ORDER BY depth DESC`, [id]);
    if (chain.length === 0)
        throw new HttpError(404, "Gerät nicht gefunden");

    const top = chain[0];   // the device that is directly in the room
    const device = chain[chain.length - 1];
    const path = [
        { kind: "room", id: top.room_id, name: top.room_name },
        ...chain.map((d) => ({ kind: "device", id: d.id, name: d.name })),
    ];
    const { rows: features } = await db.query(
        "SELECT id, type, name, kind, exclusive, active FROM features WHERE device_id = $1 ORDER BY id", [id]);

    return {
        id: device.id,
        name: device.name,
        type: device.type,
        pinned: device.pinned_at !== null,
        path,
        parent: path[path.length - 2],
        children: await listDevices("parent_device_id", id),
        features,
    };
}

/*************** Settings *********************************************************************/
// select options as [{ value, label }], also written as plain values ["HDMI 1", "HDMI 2"]
function selectOptions(options) {
    return (options ?? []).map((option) => option !== null && typeof option === "object"
        ? { value: option.value, label: String(option.label ?? option.value) }
        : { value: option, label: String(option) });
}

// decimals of a step, e.g. 0.05 -> 2, used to remove float noise like 0.30000000000000004
function decimals(step) {
    const text = String(step);
    return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

// checks a value against its definition (setting_definitions), returns the normalized value
// or throws an HttpError with a message for the page
function validateValue(definition, value) {
    const fail = (message) => {
        throw new HttpError(400, `${definition.label}: ${message}`);
    };
    switch (definition.type) {
        case "range":
        case "number": {
            if (typeof value !== "number" || !Number.isFinite(value))
                fail("muss eine Zahl sein");
            if (definition.min !== null && value < definition.min)
                fail(`muss mindestens ${definition.min} sein`);
            if (definition.max !== null && value > definition.max)
                fail(`darf höchstens ${definition.max} sein`);
            const step = definition.step ?? 1;
            const steps = (value - (definition.min ?? 0)) / step;
            if (Math.abs(steps - Math.round(steps)) > 1e-9)
                fail(step === 1 ? "muss eine ganze Zahl sein" : `muss in Schritten von ${step} sein`);
            return Number((Math.round(steps) * step + (definition.min ?? 0)).toFixed(decimals(step)));
        }
        case "boolean":
            if (typeof value !== "boolean")
                fail("muss an oder aus sein");
            return value;
        case "text":
            if (typeof value !== "string")
                fail("muss ein Text sein");
            if (value.length > 1000 || /[\r\n]/.test(value))
                fail("darf höchstens 1000 Zeichen und keine Zeilenumbrüche haben");
            return value;
        case "select":
        case "button_select": {
            const option = selectOptions(definition.options).find((o) => JSON.stringify(o.value) === JSON.stringify(value));
            if (!option)
                fail("ist keine der möglichen Auswahlen");
            return option.value;
        }
        case "color":
            if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
                fail("muss eine Farbe wie #ff8800 sein");
            return value.toLowerCase();
        default:
            return fail(`unbekannter Typ ${definition.type}`);
    }
}

// feature with its setting definitions and current values:
// { id, device_id, type, name, kind, executable, udp_port, exclusive, active,
//   settings: [{ name, label, type, min, max, step, unit, options, section, restart_required, value }] }
async function getFeature(id) {
    const { rows: [feature] } = await db.query(`
        SELECT id, device_id, type, name, kind, executable, udp_port, exclusive, active
        FROM features WHERE id = $1`, [id]);
    if (!feature)
        throw new HttpError(404, "Feature nicht gefunden");

    const { rows } = await db.query(`
        SELECT d.name, d.label, d.type, d.min, d.max, d.step, d.unit, d.options, d.section,
               d.restart_required, d.default_value, s.value
        FROM setting_definitions d
        LEFT JOIN settings s ON s.feature_id = d.feature_id AND s.name = d.name
        WHERE d.feature_id = $1
        ORDER BY d.sort_order, d.name`, [id]);

    feature.settings = rows.map(({ default_value: defaultValue, value, ...definition }) => {
        // a saved value that does not fit a changed definition anymore falls back to the default
        let current = defaultValue;
        if (value !== null) {
            try {
                current = validateValue(definition, value);
            } catch {
                // keep the default
            }
        }
        const hasOptions = definition.type === "select" || definition.type === "button_select";
        const options = hasOptions ? selectOptions(definition.options) : null;
        return { ...definition, options, value: current };
    });
    return feature;
}

// values: { name: normalized value }, see validateValue
async function saveSettingValues(featureId, values) {
    await db.query(`
        INSERT INTO settings (feature_id, name, value)
        SELECT $1, name, value FROM jsonb_each($2::jsonb) AS v (name, value)
        ON CONFLICT (feature_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [featureId, JSON.stringify(values)]);
}

// services that were started before the server stopped
async function activeServices() {
    const { rows } = await db.query("SELECT id FROM features WHERE kind = 'service' AND active ORDER BY id");
    return rows.map((row) => row.id);
}

/*************** Start / Stop *****************************************************************/
// starts or stops a service; starting an exclusive service stops the other exclusive services of
// the device. onChange(featureId, active) is called after the change is saved, stopped features
// first (e.g. stop ambilight before static_color starts)
async function setFeatureActive(id, active, onChange) {
    const client = await db.connect();
    let changes;
    try {
        await client.query("BEGIN");
        const { rows: [feature] } = await client.query(
            "SELECT id, device_id, kind, exclusive FROM features WHERE id = $1 FOR UPDATE", [id]);
        if (!feature)
            throw new HttpError(404, "Feature nicht gefunden");
        if (feature.kind !== "service")
            throw new HttpError(400, "Nur Dienste (kind = service) können gestartet und gestoppt werden");

        // locks the exclusive services of the device, so two requests cannot start two of them
        const { rows: before } = await client.query(`
            SELECT id, active FROM features
            WHERE id = $1 OR (device_id = $2 AND kind = 'service' AND exclusive AND $3::boolean)
            ORDER BY id FOR UPDATE`, [id, feature.device_id, feature.exclusive]);

        // stop the others first, otherwise the unique index sees two active features
        if (active && feature.exclusive)
            await client.query(`
                UPDATE features SET active = false
                WHERE device_id = $1 AND kind = 'service' AND exclusive AND active AND id <> $2`,
                [feature.device_id, id]);
        await client.query("UPDATE features SET active = $2 WHERE id = $1", [id, active]);
        await client.query("COMMIT");

        // the feature itself is always passed on: "start" again also starts a service that is
        // active but crashed, "stop" also stops a program that still runs
        const after = (f) => f.id === id ? active : (active && feature.exclusive ? false : f.active);
        changes = before
            .filter((f) => f.id === id || after(f) !== f.active)
            .map((f) => ({ id: f.id, active: after(f) }))
            .sort((a, b) => a.active - b.active);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    for (const change of changes)
        await onChange(change.id, change.active);
    return changes;
}

module.exports = {
    getTree, getPinned, setDevicePinned, getRoom, getDevice,
    getFeature, validateValue, saveSettingValues, activeServices, setFeatureActive,
};
