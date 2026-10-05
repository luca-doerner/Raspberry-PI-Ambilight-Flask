/*
 * static_color.c - setzt alle LEDs auf eine feste Farbe (Feature-Art "oneshot").
 *
 * Der Server übergibt beim Ausführen alle Geräte- und Feature-Einstellungen als --name=wert:
 *   sudo ./static_color --led_count_left=37 ... --power=on --color=#ff8800 --brightness=255
 * Unbekannte Einstellungen werden ignoriert.
 *
 * Bauen: make
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "leds.h"

static const char *power = "on";
static rgb_t color = { 255, 255, 255 };   // weiß, falls keine Farbe kommt
static int brightness = 255;

static const char *SETTING_NAMES[] = {
    "power", "color", "brightness"
};

#define SETTING_COUNT ((int)(sizeof SETTING_NAMES / sizeof *SETTING_NAMES))

// nimmt eine Einstellung an, 0 = unbekannt oder ungültig
static int set_setting(const char *name, const char *value) {
    if (strcmp(name, "power") == 0) {
        if (strcmp(value, "on") != 0 && strcmp(value, "off") != 0)
            return 0;
        power = strcmp(value, "on") == 0 ? "on" : "off";
    } else if (strcmp(name, "color") == 0) {
        // %2hhx: zwei Hex-Ziffern in ein uint8_t, "#ff8800"
        if (sscanf(value, "#%2hhx%2hhx%2hhx", &color.r, &color.g, &color.b) != 3)
            return 0;
    } else if (strcmp(name, "brightness") == 0) {
        int number = atoi(value);
        if (number < 0 || number > 255)
            return 0;
        brightness = number;
    } else {
        return 0;
    }
    return 1;
}

int main(int argc, char *argv[]) {
    // Geräte-Einstellungen (Anzahl LEDs, Pin, DMA) und danach die eigenen Einstellungen
    led_config_t config = load_config(argc, argv);
    load_settings(argc, argv, SETTING_COUNT, SETTING_NAMES, set_setting);

    if (config.led_count < 1) {
        fprintf(stderr, "Keine LEDs: led_count_left/top/right/bottom angeben\n");
        return EXIT_FAILURE;
    }

    ws2811_t strip;
    if (leds_init(&strip, config.led_count, config.led_pin, config.led_dma, brightness) < 0)
        return EXIT_FAILURE;

    // "off" heißt schwarz, ein echtes Aus kennen WS2812-LEDs nicht
    int on = strcmp(power, "on") == 0;
    if (on)
        leds_fill(&strip, color.r, color.g, color.b);
    else
        leds_off(&strip);
    if (on)
        printf("%d LEDs auf #%02x%02x%02x gesetzt (Helligkeit %d)\n",
               config.led_count, color.r, color.g, color.b, brightness);
    else
        printf("%d LEDs ausgeschaltet\n", config.led_count);

    ws2811_fini(&strip);
    return EXIT_SUCCESS;
}
