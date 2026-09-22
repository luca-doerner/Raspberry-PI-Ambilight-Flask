// Log of the server and of the feature programs: printed to the terminal / journal and
// streamed to the web pages (browser console) as Server-Sent Events.
const LOG_LINES = 200;    // how many lines are kept for newly opened pages

const logEntries = [];        // last LOG_LINES entries { id, time, stream, source, featureId, line }
const logClients = new Set(); // open log streams of web pages
let logId = 0;

// stream: "stdout" / "stderr" = output of a feature program, "server" = message of this server;
// feature (optional): { id, name } of the feature the line belongs to
function log(line, stream = "server", feature = null) {
    const entry = { id: ++logId, time: Date.now(), stream, source: feature?.name ?? "server", featureId: feature?.id ?? null, line };
    const prefix = stream === "server" ? "" : `[${entry.source}] `;
    (stream === "stderr" ? process.stderr : process.stdout).write(`${prefix}${line}\n`);

    logEntries.push(entry);
    if (logEntries.length > LOG_LINES)
        logEntries.shift();
    for (const res of logClients)
        writeLogEntry(res, entry);
}

function writeLogEntry(res, entry) {
    res.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`);
}

// splits the output of a program into lines, a chunk can end in the middle of a line;
// onLine (optional) is called with every complete line
function logLines(readable, stream, feature, onLine = () => {}) {
    let rest = "";
    readable.setEncoding("utf8");
    readable.on("data", (chunk) => {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop();
        for (const line of lines) {
            log(line.replace(/\r$/, ""), stream, feature);
            onLine(line);
        }
    });
    readable.on("end", () => {
        if (rest) {
            log(rest, stream, feature);
            onLine(rest);
        }
    });
}

// Server-Sent Events: starts with the last LOG_LINES lines
// (after a reconnect only the lines the page has not seen yet)
function streamLog(req, res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });
    const lastId = Number(req.headers["last-event-id"]) || 0;
    const seenBefore = lastId <= logId;   // otherwise the server was restarted
    for (const entry of logEntries)
        if (!seenBefore || entry.id > lastId)
            writeLogEntry(res, entry);
    logClients.add(res);
    req.on("close", () => logClients.delete(res));
}

module.exports = { log, logLines, streamLog };
