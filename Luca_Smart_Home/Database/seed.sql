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

    INSERT INTO features (device_id, type, name, kind, executable, udp_port, exclusive)
        VALUES (v_leds_id, 'ambilight', 'Ambilight', 'service', 'C/ambilight', 9000, true);
END
$$;

-- The settings of ambilight.c for every ambilight feature that has no setting definitions yet
-- (new databases and databases from before setting_definitions existed). Definitions that were
-- changed later are kept.
INSERT INTO setting_definitions
    (feature_id, name, label, type, default_value, min, max, step, unit, section, sort_order)
SELECT f.id, d.name, d.label, d.type, d.default_value, d.min, d.max, 1, d.unit, d.section, d.sort_order
FROM features f
CROSS JOIN (VALUES
    ('brightness',      'Helligkeit',  'range',  '70'::jsonb, 0, 100, '%', 'Farbe',                10),
    ('smooth_ratio',    'Glättung',    'range',  '85',        0, 100, '%', 'Farbe',                20),
    ('dark_gamma',      'Dark Gamma',  'range',  '20',        0, 100, '%', 'Farbe',                30),
    ('resize_size',     'Resize Size', 'number', '18',        1, 100, NULL, 'Abtastung',           40),
    ('distance_top',    'Oben',        'number', '1',         0, 100, NULL, 'Abstand zum Bildrand', 50),
    ('distance_left',   'Links',       'number', '1',         0, 100, NULL, 'Abstand zum Bildrand', 60),
    ('distance_right',  'Rechts',      'number', '1',         0, 100, NULL, 'Abstand zum Bildrand', 70),
    ('distance_bottom', 'Unten',       'number', '1',         0, 100, NULL, 'Abstand zum Bildrand', 80)
) AS d (name, label, type, default_value, min, max, unit, section, sort_order)
WHERE f.type = 'ambilight'
  AND NOT EXISTS (SELECT 1 FROM setting_definitions s WHERE s.feature_id = f.id);
