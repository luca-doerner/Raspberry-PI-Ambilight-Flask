-- Start data: Wohnzimmer -> Fernseher -> Ambilight LEDs -> feature "ambilight"
--
-- Only runs while there is no ambilight feature yet, so renaming or moving the entries
-- later is fine, they are not created again on the next deploy.
DO $$
DECLARE
    v_room_id BIGINT;
    v_tv_id   BIGINT;
    v_leds_id BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM features WHERE type = 'ambilight') THEN
        RETURN;
    END IF;

    INSERT INTO rooms (name) VALUES ('Wohnzimmer')
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_room_id;

    INSERT INTO devices (room_id, name, type) VALUES (v_room_id, 'Fernseher', 'tv')
        ON CONFLICT ON CONSTRAINT devices_unique_name DO UPDATE SET type = EXCLUDED.type
        RETURNING id INTO v_tv_id;

    INSERT INTO devices (parent_device_id, name, type) VALUES (v_tv_id, 'Ambilight LEDs', 'led_strip')
        ON CONFLICT ON CONSTRAINT devices_unique_name DO UPDATE SET type = EXCLUDED.type
        RETURNING id INTO v_leds_id;

    INSERT INTO features (device_id, type, name, executable, exclusive)
        VALUES (v_leds_id, 'ambilight', 'Ambilight', 'C/ambilight', true);
END
$$;
