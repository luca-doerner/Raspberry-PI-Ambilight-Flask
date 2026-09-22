/*
 * static_color.c - setzt alle LEDs auf eine feste Farbe (Feature-Art "oneshot").
 *
 * Der Server übergibt beim Ausführen alle Geräte- und Feature-Einstellungen als --name=wert:
 *   sudo ./static_color --led_count_left=37 ... --power=on --color=#ff8800 --brightness=255
 * Unbekannte Einstellungen werden ignoriert.
 *
 * Bauen: make
 */
#include <getopt.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "leds.h"

// eigene Optionen, andere Zahlen als die in leds.h (OPT_LED_* ab 1001)
#define OPT_POWER      2001
#define OPT_COLOR      2002
#define OPT_BRIGHTNESS 2003

int main(int argc, char *argv[]) {
    // Geräte-Einstellungen (Anzahl LEDs, Pin, DMA) aus der Kommandozeile
    led_config_t config = load_config(argc, argv);

    const char *power = "on";
    unsigned red = 255, green = 255, blue = 255;   // weiß, falls keine Farbe kommt
    int brightness = 255;

    static struct option long_options[] = {
        {"power", required_argument, 0, OPT_POWER},
        {"color", required_argument, 0, OPT_COLOR},
        {"brightness", required_argument, 0, OPT_BRIGHTNESS},
        {0, 0, 0, 0}
    };

    opterr = 0;   // unbekannte Optionen nicht melden
    int opt;
    while ((opt = getopt_long(argc, argv, "", long_options, NULL)) != -1) {
        switch (opt) {
            case OPT_POWER:
                power = optarg;
                break;
            case OPT_COLOR:
                if (sscanf(optarg, "#%2x%2x%2x", &red, &green, &blue) != 3) {
                    fprintf(stderr, "Ungültige Farbe: %s\n", optarg);
                    return EXIT_FAILURE;
                }
                break;
            case OPT_BRIGHTNESS:
                brightness = atoi(optarg);
                break;
            default:
                break;   // Einstellung eines anderen Features
        }
    }

    if (config.led_count < 1) {
        fprintf(stderr, "Keine LEDs: led_count_left/top/right/bottom angeben\n");
        return EXIT_FAILURE;
    }
    if (brightness < 0 || brightness > 255) {
        fprintf(stderr, "brightness muss zwischen 0 und 255 liegen\n");
        return EXIT_FAILURE;
    }

    ws2811_t strip;
    if (leds_init(&strip, config.led_count, config.led_pin, config.led_dma, brightness) < 0)
        return EXIT_FAILURE;

    // "off" heißt schwarz, ein echtes Aus kennen WS2812-LEDs nicht
    int on = strcmp(power, "on") == 0;
    if (on)
        leds_fill(&strip, red, green, blue);
    else
        leds_off(&strip);
    if (on)
        printf("%d LEDs auf #%02x%02x%02x gesetzt (Helligkeit %d)\n",
               config.led_count, red, green, blue, brightness);
    else
        printf("%d LEDs ausgeschaltet\n", config.led_count);

    ws2811_fini(&strip);
    return EXIT_SUCCESS;
}
