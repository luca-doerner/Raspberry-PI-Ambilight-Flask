/*
 * Web server of the smart home: rooms, nested devices and their features.
 *
 * - pages: /rooms, /rooms/:id, /devices/:id (one page, public/index.html + public/app.js)
 * - features and their settings come from the database, their programs run in features.js
 *
 * Run (needs root, because the ambilight program needs root for the LEDs):
 *   sudo node server.js
 *
 * Environment variables:
 *   PORT           web server port (default 5000)
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *                  PostgreSQL database (Database/schema.sql)
 *   UDP_HOST       receiver of the UDP messages of the services (default 127.0.0.1)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const HttpError = require("./http-error");
const { log, streamLog } = require("./log");
const smarthome = require("./smarthome");
const features = require("./features");

/*************** Configuration ****************************************************************/
const PORT = Number(process.env.PORT) || 5000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

db.on("error", (err) => log(`Datenbankfehler: ${err.message}`));

/*************** HTTP Helpers *****************************************************************/
// API answers are never cached, they always show the current state
function sendJson(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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
                reject(new HttpError(400, "Ungültiges JSON"));
            }
        });
        req.on("error", reject);
    });
}

// files from public/, only plain names like "app.js" or "feature-panel.js";
// no-cache: browsers and Cloudflare have to ask on every use whether the file changed (ETag),
// otherwise they keep showing old files after a deploy; unchanged files are answered with 304
async function serveFile(req, res, file) {
    if (!/^[\w-]+(\/[\w-]+)*\.(html|css|js)$/.test(file))
        return sendJson(res, 404, { error: "Nicht gefunden" });
    const fullPath = path.join(PUBLIC_DIR, file);
    let stat;
    try {
        stat = await fs.promises.stat(fullPath);
    } catch {
        return sendJson(res, 404, { error: "Nicht gefunden" });
    }

    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = { "Content-Type": MIME_TYPES[path.extname(file)], "Cache-Control": "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, headers);
        return res.end();
    }
    res.writeHead(200, headers);
    res.end(await fs.promises.readFile(fullPath));
}

function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

// feature with its settings and the state of its program; the executable is not sent to the page
async function featureWithState(id) {
    const { executable, ...feature } = await smarthome.getFeature(id);
    return { ...feature, hasProgram: Boolean(executable), state: features.state(id) };
}

// the state that changes while the page is open: started or not and the program
async function featureState(id) {
    const { active } = await smarthome.getFeature(id);
    return { active, ...features.state(id) };
}

/*************** Routes ***********************************************************************/
// [method, path pattern, handler(req, res, ...pattern groups)]
const ROUTES = [
    // pages (the page itself loads its data from the API)
    ["GET", /^\/$/, (req, res) => redirect(res, "/rooms")],
    ["GET", /^\/(rooms|rooms\/\d+|devices\/\d+)$/, (req, res) => serveFile(req, res, "index.html")],
    // old address of the ambilight page
    ["GET", /^\/ambilight$/, async (req, res) => {
        const { rows: [feature] } = await db.query("SELECT id, device_id FROM features WHERE type = 'ambilight' ORDER BY id LIMIT 1");
        redirect(res, feature ? `/devices/${feature.device_id}?feature=${feature.id}` : "/rooms");
    }],

    // navigation, rooms and devices
    ["GET", /^\/api\/navigation$/, async (req, res) => sendJson(res, 200, {
        rooms: await smarthome.getTree(),
        pinned: await smarthome.getPinned(),
    })],
    ["GET", /^\/api\/rooms\/(\d+)$/, async (req, res, id) => sendJson(res, 200, await smarthome.getRoom(Number(id)))],
    // features with running / message, so the page can tell "started" from "really running"
    ["GET", /^\/api\/devices\/(\d+)$/, async (req, res, id) => {
        const device = await smarthome.getDevice(Number(id));
        device.features = device.features.map((feature) => {
            const { running, message } = features.state(feature.id);
            return { ...feature, running, message };
        });
        sendJson(res, 200, device);
    }],
    ["POST", /^\/api\/devices\/(\d+)\/pinned$/, async (req, res, id) => {
        const { pinned } = await readJson(req);
        if (typeof pinned !== "boolean")
            throw new HttpError(400, "pinned muss true oder false sein");
        sendJson(res, 200, { pinned: await smarthome.setDevicePinned(Number(id), pinned) });
    }],

    // features
    ["GET", /^\/api\/features\/(\d+)$/, async (req, res, id) => sendJson(res, 200, await featureWithState(Number(id)))],
    ["GET", /^\/api\/features\/(\d+)\/state$/, async (req, res, id) => sendJson(res, 200, await featureState(Number(id)))],
    // start (true) or stop (false) a service
    ["POST", /^\/api\/features\/(\d+)\/active$/, async (req, res, id) => {
        const { active } = await readJson(req);
        if (typeof active !== "boolean")
            throw new HttpError(400, "active muss true oder false sein");
        const changes = await smarthome.setFeatureActive(Number(id), active, features.setActive);
        sendJson(res, 200, { changes, state: await featureState(Number(id)) });
    }],
    // { values: { name: value, ... } }, applied depending on the kind of the feature
    ["POST", /^\/api\/features\/(\d+)\/settings$/, async (req, res, id) => {
        const { values } = await readJson(req);
        const result = await features.applySettings(Number(id), values);
        sendJson(res, 200, { ...result, state: await featureState(Number(id)) });
    }],

    // output of the feature programs and server messages as Server-Sent Events
    ["GET", /^\/api\/log$/, (req, res) => streamLog(req, res)],
];

async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
        for (const [method, pattern, handler] of ROUTES) {
            const match = req.method === method && url.pathname.match(pattern);
            if (match)
                return await handler(req, res, ...match.slice(1));
        }
        if (req.method === "GET" && !url.pathname.startsWith("/api/"))
            return await serveFile(req, res, url.pathname.slice(1));
        sendJson(res, 404, { error: "Nicht gefunden" });
    } catch (err) {
        if (!(err instanceof HttpError))
            console.error(err);
        if (!res.headersSent)
            sendJson(res, err.status || 500, { error: err.message });
    }
}

/*************** Main *************************************************************************/
features.init();

const server = http.createServer(handle);
server.listen(PORT, () => {
    log(`Webserver läuft auf http://localhost:${PORT}`);
});

// stop the programs (ambilight switches the LEDs off) when the web server is stopped
async function shutdown() {
    await features.shutdown();
    await db.end().catch(() => {});
    server.close();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
