#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <getopt.h>
#include "leds.h"      // eigene Header mit "…", System-Header mit <…>

int leds_init(ws2811_t *strip, int led_count, int led_pin, int led_dma, int brightness) {
    *strip = (ws2811_t){
        .freq = WS2811_TARGET_FREQ,
        .dmanum = led_dma,
        .channel = {
            [0] = { .gpionum = led_pin, .count = led_count, .invert = 0,
                    .brightness = brightness, .strip_type = WS2811_STRIP_GRB },
            [1] = { .gpionum = 0, .count = 0, .invert = 0, .brightness = 0 },
        },
    };
    ws2811_return_t ret = ws2811_init(strip);
    if (ret != WS2811_SUCCESS) {
        fprintf(stderr, "ws2811_init fehlgeschlagen: %s\n", ws2811_get_return_t_str(ret));
        return -1;
    }
    return 0;
}

void leds_fill(ws2811_t *strip, uint8_t red, uint8_t green, uint8_t blue) {
    ws2811_led_t color = ((uint32_t)red << 16) | ((uint32_t)green << 8) | blue;
    for (int i = 0; i < strip->channel[0].count; i++)
        strip->channel[0].leds[i] = color;
    ws2811_render(strip);
    ws2811_wait(strip);
}

void leds_off(ws2811_t *strip) {
    memset(strip->channel[0].leds, 0, strip->channel[0].count * sizeof(ws2811_led_t));
    ws2811_render(strip);
    ws2811_wait(strip);
    ws2811_fini(strip);
}

led_config_t load_config(int argc, char *argv[]) {
    led_config_t config;

    static struct option long_options[] = {
        {"led_count_left", required_argument, 0, OPT_LED_COUNT_LEFT},
        {"led_count_top", required_argument, 0, OPT_LED_COUNT_TOP},
        {"led_count_right", required_argument, 0, OPT_LED_COUNT_RIGHT},
        {"led_count_bottom", required_argument, 0, OPT_LED_COUNT_BOTTOM},
        {"led-pin", required_argument, 0, OPT_LED_PIN},
        {"led-dma", required_argument, 0, OPT_LED_DMA},
        {0, 0, 0, 0}
    };

    opterr = 0;
    int opt;
    while ((opt = getopt_long(argc, argv, "", long_options, NULL)) != -1) {
        switch (opt) {
            case OPT_LED_COUNT_LEFT:
                config.led_count_left = atoi(optarg);
                break;
            case OPT_LED_COUNT_TOP:
                config.led_count_top = atoi(optarg);
                break;
            case OPT_LED_COUNT_RIGHT:
                config.led_count_right = atoi(optarg);
                break;
            case OPT_LED_COUNT_BOTTOM:
                config.led_count_bottom = atoi(optarg);
                break;
            case OPT_LED_PIN:
                config.led_pin = atoi(optarg);
                break;
            case OPT_LED_DMA:
                config.led_dma = atoi(optarg);
                break;
            default:
                break;
        }
    }

    config.led_count = config.led_count_left + config.led_count_top + config.led_count_right + config.led_count_bottom;

    optind = 1;

    return config;
}