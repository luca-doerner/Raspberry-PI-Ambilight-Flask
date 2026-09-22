-- Smart home database: rooms -> devices (nestable) -> features -> settings
--
-- Can be run again at any time (every deploy runs it), it only creates what is missing.
-- Needs PostgreSQL 15 or newer (UNIQUE NULLS NOT DISTINCT).

-- no "already exists, skipping" notices when it runs again
SET client_min_messages = warning;

-- a room of the house, e.g. "Wohnzimmer"
CREATE TABLE IF NOT EXISTS rooms (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- a device, either directly in a room (room_id) or plugged into another device (parent_device_id),
-- e.g. the ambilight LEDs hang on the TV, the TV is in the living room
CREATE TABLE IF NOT EXISTS devices (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id          BIGINT REFERENCES rooms (id) ON DELETE CASCADE,
    parent_device_id BIGINT REFERENCES devices (id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    type             TEXT,              -- free text, e.g. "tv", "light", "led_strip"
    pinned_at        TIMESTAMPTZ,       -- pinned in the navigation since then, NULL = not pinned
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT devices_one_location CHECK (num_nonnulls(room_id, parent_device_id) = 1),
    -- names are unique per room or per parent device
    CONSTRAINT devices_unique_name UNIQUE NULLS NOT DISTINCT (room_id, parent_device_id, name)
);

-- databases created before pinning existed
ALTER TABLE devices ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS devices_room_id_idx ON devices (room_id);
CREATE INDEX IF NOT EXISTS devices_parent_device_id_idx ON devices (parent_device_id);

-- a device must never end up inside itself (A -> B -> A)
CREATE OR REPLACE FUNCTION devices_check_cycle() RETURNS trigger AS $$
BEGIN
    IF NEW.parent_device_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors (id) AS (
            SELECT NEW.parent_device_id
            UNION   -- UNION instead of UNION ALL also stops at cycles that already exist
            SELECT d.parent_device_id
            FROM devices d
            JOIN ancestors a ON d.id = a.id
            WHERE d.parent_device_id IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN
        RAISE EXCEPTION 'Gerät % (%) kann nicht in sich selbst verschachtelt werden', NEW.id, NEW.name;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER devices_no_cycle
    BEFORE INSERT OR UPDATE OF parent_device_id ON devices
    FOR EACH ROW EXECUTE FUNCTION devices_check_cycle();

-- how the server runs the program of a feature; a new kind needs a row here and its code in
-- Node/features.js
CREATE TABLE IF NOT EXISTS feature_kinds (
    name        TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

INSERT INTO feature_kinds (name, description) VALUES
    ('service', 'Läuft dauerhaft mit Start und Stopp; Einstellungen gehen sofort per UDP an das Programm, '
                || 'Einstellungen mit restart_required erst nach Speichern und Neustart'),
    ('oneshot', 'Läuft einmal, wenn Einstellungen gespeichert werden; die Einstellungen kommen als '
                || '--name=wert auf der Kommandozeile')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- a function of a device, e.g. "ambilight" on the LEDs or later "hdmi_switch" on the TV
--
-- kind:       how the program runs, see feature_kinds
-- executable: program of the feature, relative to Luca_Smart_Home/ or absolute; it gets all settings
--             as --name=value on the command line
-- udp_port:   service only: the settings without restart_required are sent there as "name: value"
--             whenever they change and after the program printed a line starting with "Started"
-- exclusive:  of the exclusive services of a device only one can run at the same time, e.g. the LEDs
--             show either "ambilight" or "static_color"; an exclusive oneshot stops the exclusive
--             services of its device before it runs
-- active:     service only: the feature is started (the server starts it again after a restart)
CREATE TABLE IF NOT EXISTS features (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id  BIGINT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    type       TEXT NOT NULL,           -- free text, e.g. "ambilight"
    name       TEXT NOT NULL,           -- display name
    kind       TEXT NOT NULL DEFAULT 'service' REFERENCES feature_kinds (name),
    executable TEXT,
    udp_port   INTEGER CHECK (udp_port BETWEEN 1 AND 65535),
    exclusive  BOOLEAN NOT NULL DEFAULT false,
    active     BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT features_unique_name UNIQUE (device_id, name)
);

-- databases created before kind existed: all features were services
ALTER TABLE features ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'service' REFERENCES feature_kinds (name);

-- databases created before udp_port existed: ambilight listened on port 9000
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'features' AND column_name = 'udp_port'
    ) THEN
        ALTER TABLE features ADD COLUMN udp_port INTEGER CHECK (udp_port BETWEEN 1 AND 65535);
        UPDATE features SET udp_port = 9000 WHERE type = 'ambilight';
    END IF;
END
$$;

-- databases created before exclusive/active existed: add the columns once,
-- ambilight features become exclusive (later changes to exclusive are kept)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'features' AND column_name = 'exclusive'
    ) THEN
        ALTER TABLE features ADD COLUMN exclusive BOOLEAN NOT NULL DEFAULT false;
        UPDATE features SET exclusive = true WHERE type = 'ambilight';
    END IF;
END
$$;
ALTER TABLE features ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS features_type_idx ON features (type);

-- at most one active exclusive feature per device
CREATE UNIQUE INDEX IF NOT EXISTS features_one_active_exclusive ON features (device_id) WHERE exclusive AND active;

-- the settings a feature has, the web page shows them from this table
CREATE TABLE IF NOT EXISTS setting_definitions (
    feature_id       BIGINT NOT NULL REFERENCES features (id) ON DELETE CASCADE,
    -- key for the database, UDP and the command line, e.g. "brightness"
    name             TEXT NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*$'),
    label            TEXT NOT NULL,     -- shown on the page, e.g. "Helligkeit"
    -- range: slider, number: number field, boolean: switch, text, select: list of options,
    -- button_select: one button per option, color: #rrggbb (allowed types: see the constraint below)
    type             TEXT NOT NULL,
    default_value    JSONB NOT NULL,    -- used until the setting is changed, e.g. 70, true, "HDMI 1"
    min              DOUBLE PRECISION,  -- range / number
    max              DOUBLE PRECISION,  -- range / number
    step             DOUBLE PRECISION,  -- range / number, 1 = whole numbers only (default)
    unit             TEXT,              -- shown after the value, e.g. "%"
    -- select / button_select: ["HDMI 1", "HDMI 2"] or [{"value": 1, "label": "HDMI 1"}]
    options          JSONB,
    section          TEXT,              -- heading on the page, settings with the same section are shown together
    -- service only: the program has to be restarted to use a new value (saved with a button)
    restart_required BOOLEAN NOT NULL DEFAULT false,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (feature_id, name)
);

-- The rules for type and options are replaced on every run, so a new type only has to be added
-- here (CREATE TABLE IF NOT EXISTS does not change an existing table). setting_definitions_check
-- is the options rule of databases from before the rules had names.
ALTER TABLE setting_definitions DROP CONSTRAINT IF EXISTS setting_definitions_type_check;
ALTER TABLE setting_definitions ADD CONSTRAINT setting_definitions_type_check
    CHECK (type IN ('range', 'number', 'boolean', 'text', 'select', 'button_select', 'color'));

ALTER TABLE setting_definitions DROP CONSTRAINT IF EXISTS setting_definitions_check;
ALTER TABLE setting_definitions DROP CONSTRAINT IF EXISTS setting_definitions_options_check;
-- COALESCE: without options jsonb_typeof is NULL and a CHECK lets NULL pass
ALTER TABLE setting_definitions ADD CONSTRAINT setting_definitions_options_check
    CHECK (type NOT IN ('select', 'button_select') OR COALESCE(jsonb_typeof(options) = 'array', false));

-- the current value of a setting, e.g. brightness = 70; settings without a row use their default_value
CREATE TABLE IF NOT EXISTS settings (
    feature_id BIGINT NOT NULL REFERENCES features (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (feature_id, name)
);

-- people who can log in to the web page, added with Node/user.js (there is no sign up page)
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{1,64}$'),
    password_hash TEXT NOT NULL,      -- scrypt$N$r$p$salt$hash, never the password itself
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Luca" and "luca" are the same user
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username));

-- logged in browsers: the session cookie holds a random token, only its SHA-256 hash is stored,
-- so the database alone is not enough to take over a session
CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- every device with the room it is in (also through parent devices) and its path,
-- e.g. "Wohnzimmer / Fernseher / Ambilight LEDs"
CREATE OR REPLACE VIEW devices_with_room AS
WITH RECURSIVE tree AS (
    SELECT d.id, d.name, d.type, d.parent_device_id, d.room_id, 0 AS depth,
           r.name || ' / ' || d.name AS path
    FROM devices d
    JOIN rooms r ON r.id = d.room_id
    UNION ALL
    SELECT d.id, d.name, d.type, d.parent_device_id, t.room_id, t.depth + 1,
           t.path || ' / ' || d.name
    FROM devices d
    JOIN tree t ON d.parent_device_id = t.id
)
SELECT * FROM tree;
