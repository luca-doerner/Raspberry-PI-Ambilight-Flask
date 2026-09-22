// login page: sends username and password, the server answers with the session cookie
const form = document.getElementById("login-form");
const username = document.getElementById("username");
const password = document.getElementById("password");
const button = document.getElementById("login-button");
const error = document.getElementById("login-error");

// where to go after the login: ?next=/devices/2; only pages of this server, the browser itself
// decides where a link goes (it reads "//other.host" and "/\other.host" as other servers)
function nextPage() {
    const next = new URLSearchParams(location.search).get("next");
    if (!next)
        return "/rooms";
    const url = new URL(next, location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : "/rooms";
}

function showError(message) {
    error.textContent = message;
    error.hidden = !message;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!username.value || !password.value) {
        showError("Bitte Benutzername und Passwort eingeben.");
        (username.value ? password : username).focus();
        return;
    }
    button.disabled = true;
    button.textContent = "Anmelden …";
    showError("");
    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username.value, password: password.value }),
        });
        if (res.ok) {
            location.replace(nextPage());
            return;
        }
        const data = await res.json().catch(() => ({}));
        showError(data.error || "Anmeldung fehlgeschlagen.");
        password.value = "";
        password.focus();
    } catch {
        showError("Server nicht erreichbar.");
    } finally {
        button.disabled = false;
        button.textContent = "Anmelden";
    }
});
