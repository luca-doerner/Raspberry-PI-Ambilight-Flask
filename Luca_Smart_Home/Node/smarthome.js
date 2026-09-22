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
            SELECT id, name, type, room_id, parent_device_id, 0 AS depth FROM devices WHERE id = $1
            UNION ALL
            SELECT d.id, d.name, d.type, d.room_id, d.parent_device_id, up.depth + 1
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
        "SELECT id, type, name, exclusive, active FROM features WHERE device_id = $1 ORDER BY id", [id]);

    return {
        id: device.id,
        name: device.name,
        type: device.type,
        path,
        parent: path[path.length - 2],
        children: await listDevices("parent_device_id", id),
        features,
    };
}

async function getFeature(id) {
    const { rows: [feature] } = await db.query(
        "SELECT id, device_id, type, name, exclusive, active FROM features WHERE id = $1", [id]);
    if (!feature)
        throw new HttpError(404, "Feature nicht gefunden");
    const { rows } = await db.query("SELECT name, value FROM settings WHERE feature_id = $1 ORDER BY name", [id]);
    feature.settings = Object.fromEntries(rows.map((s) => [s.name, s.value]));
    return feature;
}

// switches a feature on or off; switching an exclusive feature on switches the other exclusive
// features of the device off. Only exclusive features and types with a handler can be switched.
// handlers: { [type]: { setActive(featureId, active) } }, called after the change is saved,
// switched off features first (e.g. stop ambilight before static_color starts)
async function setFeatureActive(id, active, handlers) {
    const client = await db.connect();
    let changes;
    try {
        await client.query("BEGIN");
        const { rows: [feature] } = await client.query(
            "SELECT id, device_id, type, exclusive FROM features WHERE id = $1 FOR UPDATE", [id]);
        if (!feature)
            throw new HttpError(404, "Feature nicht gefunden");
        if (!feature.exclusive && !handlers[feature.type])
            throw new HttpError(400, "Dieses Feature kann nicht ein- und ausgeschaltet werden");

        // locks the exclusive features of the device, so two requests cannot switch on two of them
        const { rows: before } = await client.query(`
            SELECT id, type, active FROM features
            WHERE id = $1 OR (device_id = $2 AND exclusive AND $3::boolean)
            ORDER BY id FOR UPDATE`, [id, feature.device_id, feature.exclusive]);

        // switch the others off first, otherwise the unique index sees two active features
        if (active && feature.exclusive)
            await client.query(
                "UPDATE features SET active = false WHERE device_id = $1 AND exclusive AND active AND id <> $2",
                [feature.device_id, id]);
        await client.query("UPDATE features SET active = $2 WHERE id = $1", [id, active]);
        await client.query("COMMIT");

        const after = (f) => f.id === id ? active : (active && feature.exclusive ? false : f.active);
        changes = before
            .filter((f) => after(f) !== f.active)
            .map((f) => ({ id: f.id, type: f.type, active: after(f) }))
            .sort((a, b) => a.active - b.active);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    for (const change of changes)
        await handlers[change.type]?.setActive(change.id, change.active);
    return changes;
}

module.exports = { getTree, getRoom, getDevice, getFeature, setFeatureActive };
