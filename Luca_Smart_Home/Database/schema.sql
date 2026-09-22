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
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT devices_one_location CHECK (num_nonnulls(room_id, parent_device_id) = 1),
    -- names are unique per room or per parent device
    CONSTRAINT devices_unique_name UNIQUE NULLS NOT DISTINCT (room_id, parent_device_id, name)
);

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

-- a function of a device, e.g. "ambilight" on the LEDs or later "hdmi_switch" on the TV
CREATE TABLE IF NOT EXISTS features (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id  BIGINT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    type       TEXT NOT NULL,           -- what the software does with it, e.g. "ambilight"
    name       TEXT NOT NULL,           -- display name
    executable TEXT,                    -- program of the feature, relative to Luca_Smart_Home/ or absolute
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT features_unique_name UNIQUE (device_id, name)
);

CREATE INDEX IF NOT EXISTS features_type_idx ON features (type);

-- one setting of a feature, e.g. brightness = 70; JSONB so later features can also store text or booleans
CREATE TABLE IF NOT EXISTS settings (
    feature_id BIGINT NOT NULL REFERENCES features (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (feature_id, name)
);

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
