#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <ws2811/ws2811.h>
#include "leds.h"

static rgb_t color = { 0, 0, 0 };
static double brightness = 1;

static const char *SETTING_NAMES[] = {
    "color", "brightness"
};

// #define statt const int: der Wert wird als Array-Größe gebraucht
#define SETTING_COUNT ((int)(sizeof SETTING_NAMES / sizeof *SETTING_NAMES))

// nimmt eine Einstellung an, 0 = unbekannt oder ungültig
static int set_setting(const char *name, const char *value) {
    if (strcmp(name, "color") == 0) {
        // %2hhx: zwei Hex-Ziffern in ein uint8_t
        if (sscanf(value, "#%2hhx%2hhx%2hhx", &color.r, &color.g, &color.b) != 3)
            return 0;
    } else if (strcmp(name, "brightness") == 0) {
        int number = atoi(value);
        if (number < 0 || number > 100)
            return 0;
        brightness = number / 100.0;
    } else {
        return 0;
    }
    return 1;
}

static void apply_color(ws2811_led_t *leds, rgb_t new_pixels[], rgb_t old_pixels[], led_config_t *config) {
    for (int i = 0; i < config->led_count; i++) {
        if(i == 0) {
            rgb_t c = color;
            uint8_t r = (uint8_t)(c.r * brightness);
            uint8_t g = (uint8_t)(c.g * brightness);
            uint8_t b = (uint8_t)(c.b * brightness);
            new_pixels[i] = (rgb_t){ r, g, b };
            leds[i] = ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
        } else {
            new_pixels[i] = old_pixels[i - 1];
            leds[i] = ((uint32_t)new_pixels[i].r << 16) | ((uint32_t)new_pixels[i].g << 8) | new_pixels[i].b;
        }
    }
    memcpy(old_pixels, new_pixels, sizeof(rgb_t) * config->led_count);
}

int main(int argc, char *argv[]) {
    init_signals();   // SIGINT/SIGTERM -> running = 0

    led_config_t config = load_config(argc, argv);
    load_settings(argc, argv, SETTING_COUNT, SETTING_NAMES, set_setting);
    if (config.led_count < 1) {
        fprintf(stderr, "Keine LEDs: led_count_left/top/right/bottom angeben\n");
        return EXIT_FAILURE;
    }

    int s;
    init_socket(&s);

    rgb_t new_pixels[config.led_count];
    rgb_t old_pixels[config.led_count];
    memset(new_pixels, 0, sizeof new_pixels);
    memset(old_pixels, 0, sizeof old_pixels);

    ws2811_t strip;
    if (leds_init(&strip, config.led_count, config.led_pin, config.led_dma, 255) < 0)
        return EXIT_FAILURE;
    printf("Started Color Flow (%d LEDs)\n", config.led_count);   // erst danach kommen die UDP-Werte

    while (get_running()) {
        poll_settings(&s, set_setting);

        ws2811_led_t *leds = strip.channel[0].leds;

        apply_color(leds, new_pixels, old_pixels, &config);

        usleep(20000);   // 50 Bilder pro Sekunde, sonst läuft die Schleife auf 100 % CPU
    }

    leds_off(&strip);
    ws2811_fini(&strip);
    return EXIT_SUCCESS;
}