// helpers shared by the pages and the feature panels

// GET (without body) or POST (with body) to the API, throws an Error with the message of the server
export async function api(url, body) {
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

// creates an element; props: attributes, "class", and "on<event>" listeners;
// children: elements or strings (always inserted as text, never as HTML)
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false)
            continue;
        if (key === "class")
            node.className = value;
        else if (key.startsWith("on"))
            node.addEventListener(key.slice(2), value);
        else
            node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
    return node;
}

export function icon(name) {
    const paths = {
        chevron: "M9 6l6 6-6 6",
        home: "M3 11l9-7 9 7M5 10v10h14V10",
        up: "M12 19V5M5 12l7-7 7 7",
        pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76"
            + "a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", `icon icon-${name}`);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", paths[name]);
    svg.append(path);
    return svg;
}

// calls fn at most every ms milliseconds, always with the latest arguments
export function throttle(fn, ms) {
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

// error box that collects one message per source ("power", a setting name, ...)
export function errorBox() {
    const errors = new Map();
    const node = el("p", { class: "error", role: "alert", hidden: true });
    return {
        node,
        // sets or clears (empty message) the error of one source
        show(source, message) {
            if (message)
                errors.set(source, message);
            else
                errors.delete(source);
            node.textContent = [...errors.values()].join("\n");
            node.hidden = errors.size === 0;
        },
    };
}
