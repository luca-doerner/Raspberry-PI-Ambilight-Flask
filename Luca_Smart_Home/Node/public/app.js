// the smart home page: navigation on the left, pages /rooms, /rooms/:id and /devices/:id
import { api, el, errorBox, icon, toggleSwitch } from "./lib.js";
import { renderAmbilight } from "./features/ambilight.js";

// panels of the feature types that have their own page, all others get the generic panel
const FEATURE_PANELS = {
    ambilight: renderAmbilight,
};

const EXPANDED_KEY = "smarthome.expanded";
const main = document.getElementById("main");
const sidebar = document.getElementById("sidebar");

/*************** Route ************************************************************************/
// key of a navigation entry: "rooms", "room:<id>" or "device:<id>"
function currentRoute() {
    const [, page, id] = location.pathname.match(/^\/(rooms|devices)(?:\/(\d+))?$/) || [];
    if (page === "devices" && id)
        return { page: "device", id: Number(id), key: `device:${id}` };
    if (page === "rooms" && id)
        return { page: "room", id: Number(id), key: `room:${id}` };
    return { page: "rooms", key: "rooms" };
}

/*************** Navigation *******************************************************************/
// which entries are expanded, remembered in this browser only
function loadExpanded() {
    try {
        return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY)) ?? ["rooms"]);
    } catch {
        return new Set(["rooms"]);
    }
}

function saveExpanded(expanded) {
    try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
        // private window or blocked storage: the navigation just forgets what was expanded
    }
}

function deviceEntry(device) {
    return { key: `device:${device.id}`, label: device.name, href: `/devices/${device.id}`,
        children: device.children.map(deviceEntry) };
}

function navigationEntries(tree) {
    return {
        key: "rooms", label: "Zimmer", href: "/rooms", icon: "home",
        children: tree.map((room) => ({
            key: `room:${room.id}`, label: room.name, href: `/rooms/${room.id}`,
            children: room.devices.map(deviceEntry),
        })),
    };
}

// keys from the top entry down to the entry with the key, null if it is not in the tree
function pathTo(entry, key) {
    if (entry.key === key)
        return [key];
    for (const child of entry.children) {
        const path = pathTo(child, key);
        if (path)
            return [entry.key, ...path];
    }
    return null;
}

function renderNavigation(tree, route) {
    const expanded = loadExpanded();
    const root = navigationEntries(tree);
    // the current page and everything above it is always expanded
    for (const key of pathTo(root, route.key) ?? [])
        expanded.add(key);
    saveExpanded(expanded);

    function entry(item, level) {
        const open = expanded.has(item.key);
        const children = item.children.length === 0 ? null
            : el("ul", { class: "tree-children", hidden: !open }, item.children.map((child) => entry(child, level + 1)));

        const toggle = children
            ? el("button", {
                class: "tree-toggle", type: "button", "aria-expanded": String(open),
                "aria-label": `${item.label} ${open ? "einklappen" : "ausklappen"}`,
                onclick() {
                    const nowOpen = children.hidden;
                    children.hidden = !nowOpen;
                    this.setAttribute("aria-expanded", String(nowOpen));
                    this.setAttribute("aria-label", `${item.label} ${nowOpen ? "einklappen" : "ausklappen"}`);
                    nowOpen ? expanded.add(item.key) : expanded.delete(item.key);
                    saveExpanded(expanded);
                },
            }, icon("chevron"))
            : el("span", { class: "tree-toggle-spacer" });

        const link = el("a", {
            class: "tree-link", href: item.href,
            "aria-current": item.key === route.key ? "page" : null,
            // clicking an entry also expands it
            onclick() {
                expanded.add(item.key);
                saveExpanded(expanded);
            },
        }, item.icon ? icon(item.icon) : null, el("span", {}, item.label));

        return el("li", {}, el("div", { class: "tree-row", style: `--level: ${level}` }, toggle, link), children);
    }

    sidebar.replaceChildren(el("ul", { class: "tree" }, entry(root, 0)));
}

// menu button on small screens
function setupMenu() {
    const button = document.getElementById("menu-toggle");
    const setOpen = (open) => {
        document.body.classList.toggle("menu-open", open);
        button.setAttribute("aria-expanded", String(open));
    };
    button.addEventListener("click", () => setOpen(!document.body.classList.contains("menu-open")));
    document.getElementById("backdrop").addEventListener("click", () => setOpen(false));
}

/*************** Page Parts *******************************************************************/
// replaces the content of the page, empty parts (null) are left out
function showPage(...parts) {
    main.replaceChildren(...parts.filter((part) => part !== null));
}

// items: [{ label, href }], the last one is the current page (no link)
function breadcrumb(items) {
    return el("nav", { class: "breadcrumb", "aria-label": "Pfad" },
        el("ol", {}, items.map((item, i) => el("li", {},
            i < items.length - 1
                ? el("a", { href: item.href }, item.label)
                : el("span", { "aria-current": "page" }, item.label)))));
}

function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

function deviceCard(device) {
    const meta = [plural(device.child_count, "Untergerät", "Untergeräte"), plural(device.feature_count, "Feature", "Features")];
    return el("a", { class: "card link-card", href: `/devices/${device.id}` },
        el("h3", {}, device.name),
        device.type ? el("span", { class: "badge" }, device.type) : null,
        el("p", { class: "muted" }, meta.join(" · ")));
}

function cardGrid(cards, emptyText) {
    return cards.length > 0 ? el("div", { class: "card-grid" }, cards) : el("p", { class: "empty" }, emptyText);
}

/*************** Pages ************************************************************************/
function renderRoomsPage(tree) {
    document.title = "Zimmer · Smart Home";
    showPage(
        breadcrumb([{ label: "Zimmer" }]),
        el("h1", {}, "Zimmer"),
        cardGrid(tree.map((room) => el("a", { class: "card link-card", href: `/rooms/${room.id}` },
            el("h3", {}, room.name),
            el("p", { class: "muted" }, room.devices.length === 0
                ? "Keine Geräte"
                : `${plural(room.devices.length, "Gerät", "Geräte")}: ${room.devices.map((d) => d.name).join(", ")}`))),
        "Noch keine Zimmer angelegt."));
}

async function renderRoomPage(id) {
    const room = await api(`/api/rooms/${id}`);
    document.title = `${room.name} · Smart Home`;
    showPage(
        breadcrumb([{ label: "Zimmer", href: "/rooms" }, { label: room.name }]),
        el("h1", {}, room.name),
        el("h2", {}, "Geräte"),
        cardGrid(room.devices.map(deviceCard), "In diesem Zimmer sind noch keine Geräte."));
}

function pathLink(item) {
    return { label: item.name, href: item.kind === "room" ? `/rooms/${item.id}` : `/devices/${item.id}` };
}

// the feature shown first: ?feature=<id>, otherwise the active exclusive one, otherwise the first
function selectedFeature(features) {
    const id = Number(new URLSearchParams(location.search).get("feature"));
    return features.find((f) => f.id === id)
        ?? features.find((f) => f.exclusive && f.active)
        ?? features[0];
}

function featureTabs(device, selected) {
    return el("nav", { class: "tabs", "aria-label": "Features" },
        device.features.map((f) => el("a", {
            class: "tab", href: `/devices/${device.id}?feature=${f.id}`,
            "aria-current": f.id === selected.id ? "page" : null,
            title: f.exclusive ? `${f.name}: ${f.active ? "aktiv" : "aus"} (nur ein exklusives Feature kann aktiv sein)` : f.name,
        },
        f.exclusive ? el("span", { class: `dot${f.active ? " on" : ""}`, "aria-hidden": "true" }) : null,
        f.name)));
}

// panel for feature types without their own page: switch (if possible) and the saved settings
function renderGenericFeature(container, feature, { onFeaturesChanged }) {
    const errors = errorBox();
    const header = el("section", { class: "card power" },
        el("div", {}, el("h2", {}, feature.name), el("p", { class: "muted" }, `Typ: ${feature.type}`)));
    if (feature.switchable)
        header.append(toggleSwitch({
            label: `${feature.name} ein/aus`,
            checked: feature.active,
            async onToggle(active) {
                try {
                    await api(`/api/features/${feature.id}/active`, { active });
                    errors.show("power", "");
                    onFeaturesChanged();
                } catch (err) {
                    errors.show("power", `Ein-/Ausschalten fehlgeschlagen: ${err.message}`);
                    throw err;
                }
            },
        }).node);

    const settings = Object.entries(feature.settings);
    container.append(header,
        el("section", { class: "card" },
            el("h3", {}, "Einstellungen"),
            settings.length === 0
                ? el("p", { class: "muted" }, "Keine Einstellungen gespeichert.")
                : el("dl", { class: "settings-list" }, settings.map(([name, value]) => [
                    el("dt", {}, name), el("dd", {}, JSON.stringify(value))])),
            el("p", { class: "muted" }, `Für Features vom Typ „${feature.type}“ gibt es noch keine eigene Oberfläche.`)),
        errors.node);
}

async function renderDevicePage(id) {
    let device = await api(`/api/devices/${id}`);
    document.title = `${device.name} · Smart Home`;
    const parent = pathLink(device.parent);

    const tabsSlot = el("div");
    const panel = el("div", { class: "feature-panel" });

    const exclusive = device.features.filter((f) => f.exclusive);
    showPage(
        breadcrumb([{ label: "Zimmer", href: "/rooms" }, ...device.path.slice(0, -1).map(pathLink), { label: device.name }]),
        el("div", { class: "page-header" },
            el("div", {}, el("h1", {}, device.name), device.type ? el("span", { class: "badge" }, device.type) : null),
            el("a", { class: "button", href: parent.href }, icon("up"), `Zu ${parent.label}`)),
        el("h2", {}, "Features"),
        tabsSlot,
        exclusive.length > 1
            ? el("p", { class: "muted hint" },
                `Von ${exclusive.map((f) => f.name).join(", ")} kann immer nur eins aktiv sein.`)
            : null,
        panel,
        el("h2", {}, "Untergeräte"),
        cardGrid(device.children.map(deviceCard), "An diesem Gerät hängen keine weiteren Geräte."));

    if (device.features.length === 0) {
        tabsSlot.append(el("p", { class: "empty" }, "Dieses Gerät hat keine Features."));
        return;
    }

    const selected = selectedFeature(device.features);
    tabsSlot.replaceChildren(featureTabs(device, selected));

    // after switching, other exclusive features may have been switched off: update the dots
    async function onFeaturesChanged() {
        device = await api(`/api/devices/${id}`);
        tabsSlot.replaceChildren(featureTabs(device, selected));
    }

    const feature = await api(`/api/features/${selected.id}`);
    const render = FEATURE_PANELS[feature.type] ?? renderGenericFeature;
    await render(panel, feature, { onFeaturesChanged });
}

/*************** Start ************************************************************************/
async function init() {
    setupMenu();
    const route = currentRoute();
    try {
        const tree = await api("/api/tree");
        renderNavigation(tree, route);
        if (route.page === "rooms")
            renderRoomsPage(tree);
        else if (route.page === "room")
            await renderRoomPage(route.id);
        else
            await renderDevicePage(route.id);
    } catch (err) {
        const errors = errorBox();
        errors.show("page", `Seite konnte nicht geladen werden: ${err.message}`);
        showPage(breadcrumb([{ label: "Zimmer", href: "/rooms" }, { label: "Fehler" }]), errors.node);
    }
}

init();
