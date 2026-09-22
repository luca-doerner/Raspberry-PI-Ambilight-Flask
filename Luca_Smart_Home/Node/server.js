/*
 * Web server of the smart home: rooms, nested devices and their features.
 *
 * - pages: /rooms, /rooms/:id, /devices/:id (one page, public/index.html + public/app.js)
 * - feature "ambilight" starts / stops the C program and forwards its settings via UDP (ambilight.js)
 *
 * Run (needs root, because the ambilight program needs root for the LEDs):
 *   sudo node server.js
 *
 * Environment variables:
 *   PORT           web server port (default 5000)
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *                  PostgreSQL database (Database/schema.sql)
 *   AMBILIGHT_BIN  path to the compiled ambilight program
 *                  (default: executable of the feature in the database, otherwise ../C/ambilight)
 *   AMBILIGHT_FEATURE_ID
 *                  id of the feature to use if there is more than one of type "ambilight"
 *   UDP_HOST       receiver of the UDP messages (default 127.0.0.1)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const HttpError = require("./http-error");
const { log, streamLog } = require("./log");
const smarthome = require("./smarthome");
const ambilight = require("./ambilight");

/*************** Configuration ****************************************************************/
const PORT = Number(process.env.PORT) || 5000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

// feature types the server can switch on and off
const FEATURE_HANDLERS = {
    [ambilight.FEATURE_TYPE]: { setActive: ambilight.setActive },
};

db.on("error", (err) => log(`Datenbankfehler: ${err.message}`));

/*************** HTTP Helpers *****************************************************************/
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
                reject(new HttpError(400, "Ungültiges JSON"));
            }
        });
        req.on("error", reject);
    });
}

// files from public/, only plain names like "app.js" or "features/ambilight.js"
function serveFile(res, file) {
    if (!/^[\w-]+(\/[\w-]+)*\.(html|css|js)$/.test(file))
        return sendJson(res, 404, { error: "Nicht gefunden" });
    fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
        if (err)
            return sendJson(res, 404, { error: "Nicht gefunden" });
        res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(file)] });
        res.end(data);
    });
}

function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

// the feature the server can switch, with its state and the switch information for the page
async function featureState(id) {
    const feature = await smarthome.getFeature(id);
    feature.switchable = feature.exclusive || Object.hasOwn(FEATURE_HANDLERS, feature.type);
    return feature;
}

/*************** Routes ***********************************************************************/
// [method, path pattern, handler(req, res, ...pattern groups)]
const ROUTES = [
    // pages (the page itself loads its data from the API)
    ["GET", /^\/$/, (req, res) => redirect(res, "/rooms")],
    ["GET", /^\/(rooms|rooms\/\d+|devices\/\d+)$/, (req, res) => serveFile(res, "index.html")],
    // old address of the ambilight page
    ["GET", /^\/ambilight$/, async (req, res) => {
        const id = ambilight.featureId();
        if (id === null)
            return redirect(res, "/rooms");
        const { device_id: deviceId } = await smarthome.getFeature(id);
        redirect(res, `/devices/${deviceId}?feature=${id}`);
    }],

    // navigation, rooms and devices
    ["GET", /^\/api\/tree$/, async (req, res) => sendJson(res, 200, await smarthome.getTree())],
    ["GET", /^\/api\/rooms\/(\d+)$/, async (req, res, id) => sendJson(res, 200, await smarthome.getRoom(Number(id)))],
    ["GET", /^\/api\/devices\/(\d+)$/, async (req, res, id) => sendJson(res, 200, await smarthome.getDevice(Number(id)))],

    // features
    ["GET", /^\/api\/features\/(\d+)$/, async (req, res, id) => sendJson(res, 200, await featureState(Number(id)))],
    ["POST", /^\/api\/features\/(\d+)\/active$/, async (req, res, id) => {
        const { active } = await readJson(req);
        if (typeof active !== "boolean")
            throw new HttpError(400, "active muss true oder false sein");
        const changes = await smarthome.setFeatureActive(Number(id), active, FEATURE_HANDLERS);
        sendJson(res, 200, { changes, feature: await featureState(Number(id)) });
    }],

    // feature "ambilight"
    ["GET", /^\/api\/ambilight$/, (req, res) => sendJson(res, 200, ambilight.state())],
    ["GET", /^\/api\/ambilight\/log$/, (req, res) => streamLog(req, res)],
    ["POST", /^\/api\/ambilight\/setting$/, async (req, res) => {
        const { name, value } = await readJson(req);
        sendJson(res, 200, { name, value: await ambilight.setSetting(name, value) });
    }],
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
            return serveFile(res, url.pathname.slice(1));
        sendJson(res, 404, { error: "Nicht gefunden" });
    } catch (err) {
        if (!(err instanceof HttpError))
            console.error(err);
        if (!res.headersSent)
            sendJson(res, err.status || 500, { error: err.message });
    }
}

/*************** Main *************************************************************************/
ambilight.init();

const server = http.createServer(handle);
server.listen(PORT, () => {
    log(`Webserver läuft auf http://localhost:${PORT}`);
});

// switch the LEDs off when the web server is stopped
async function shutdown() {
    await ambilight.shutdown();
    await db.end().catch(() => {});
    server.close();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
