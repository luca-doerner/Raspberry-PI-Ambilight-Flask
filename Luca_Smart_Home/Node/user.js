/*
 * Manages the users of the web page (there is no sign up page).
 *
 *   sudo node user.js add <name>        new user, asks for the password
 *   sudo node user.js password <name>   new password, logs the user out everywhere
 *   sudo node user.js delete <name>
 *   sudo node user.js list
 *
 * The database connection comes from the PG* environment variables or, if they are not set,
 * from /etc/luca-smart-home.env (written by the deploy, only readable by root, hence sudo).
 */
const fs = require("fs");

const ENV_FILE = "/etc/luca-smart-home.env";

// KEY=value lines of the env file of the systemd service
if (!process.env.PGPASSWORD && fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Z_]+)=(.*)$/);
        if (match && process.env[match[1]] === undefined)
            process.env[match[1]] = match[2];
    }
}

const auth = require("./auth");
const db = require("./db");

// piped input (echo ... | node user.js): all lines at once, handed out one per question
let pipedLines = null;

async function readPipedLine() {
    if (pipedLines === null) {
        let data = "";
        process.stdin.setEncoding("utf8");
        for await (const chunk of process.stdin)
            data += chunk;
        pipedLines = data.split(/\r?\n/);
    }
    if (pipedLines.length === 0)
        throw new Error("Keine Eingabe mehr");
    return pipedLines.shift();
}

// reads a line without showing it on the terminal
function readHidden(prompt) {
    process.stdout.write(prompt);
    if (!process.stdin.isTTY)
        return readPipedLine().finally(() => process.stdout.write("\n"));

    return new Promise((resolve, reject) => {
        const { stdin } = process;
        let input = "";
        stdin.setRawMode(true);
        stdin.setEncoding("utf8");
        const onData = (chunk) => {
            for (const char of chunk) {
                if (char === "\r" || char === "\n") {
                    stdin.setRawMode(false);
                    stdin.off("data", onData);
                    stdin.pause();
                    process.stdout.write("\n");
                    return resolve(input);
                }
                if (char === "") {   // Ctrl+C
                    stdin.setRawMode(false);
                    process.stdout.write("\n");
                    return reject(new Error("Abgebrochen"));
                }
                if (char === "" || char === "\b")
                    input = input.slice(0, -1);
                else
                    input += char;
            }
        };
        stdin.on("data", onData);
        stdin.resume();
    });
}

async function askNewPassword() {
    const password = await readHidden("Neues Passwort: ");
    auth.checkPasswordRules(password);
    if (await readHidden("Passwort wiederholen: ") !== password)
        throw new Error("Die Passwörter stimmen nicht überein");
    return auth.hashPassword(password);
}

async function findUser(name) {
    const { rows: [user] } = await db.query("SELECT id, username FROM users WHERE lower(username) = lower($1)", [name]);
    if (!user)
        throw new Error(`Benutzer „${name}“ gibt es nicht`);
    return user;
}

const COMMANDS = {
    async add(name) {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(name ?? ""))
            throw new Error("Name: 1–64 Zeichen aus Buchstaben, Zahlen, . _ -");
        const { rows: [existing] } = await db.query("SELECT 1 FROM users WHERE lower(username) = lower($1)", [name]);
        if (existing)
            throw new Error(`Benutzer „${name}“ gibt es schon (neues Passwort: node user.js password ${name})`);
        const hash = await askNewPassword();
        await db.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [name, hash]);
        console.log(`Benutzer „${name}“ angelegt.`);
    },

    async password(name) {
        const user = await findUser(name);
        const hash = await askNewPassword();
        await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, hash]);
        const { rowCount } = await db.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
        console.log(`Passwort von „${user.username}“ geändert, ${rowCount} Anmeldung(en) beendet.`);
    },

    async delete(name) {
        const user = await findUser(name);
        await db.query("DELETE FROM users WHERE id = $1", [user.id]);
        console.log(`Benutzer „${user.username}“ gelöscht.`);
    },

    async list() {
        const { rows } = await db.query(`
            SELECT u.username, u.created_at,
                   (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
            FROM users u ORDER BY lower(u.username)`);
        if (rows.length === 0)
            console.log("Noch keine Benutzer (anlegen: sudo node user.js add <name>)");
        for (const row of rows)
            console.log(`${row.username.padEnd(20)} angelegt ${row.created_at.toLocaleDateString("de-DE")}, `
                + `${row.sessions} aktive Anmeldung(en)`);
    },
};

async function main() {
    const [command, name] = process.argv.slice(2);
    if (!Object.hasOwn(COMMANDS, command) || (command !== "list" && !name)) {
        console.log("Benutzung: sudo node user.js add|password|delete <name>\n           sudo node user.js list");
        process.exitCode = 1;
        return;
    }
    try {
        await COMMANDS[command](name);
    } catch (err) {
        console.error(`Fehler: ${err.message}`);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

main();
