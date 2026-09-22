#include <stdio.h>
#include <stdlib.h>
#include <getopt.h>
#include <stdint.h>
#include <string.h>
#include <ws2811/ws2811.h>

#define LED_STRIP        WS2811_STRIP_GRB

int main(int argc, char *argv[]) {
    char* power = "off";
    unsigned red = 0, green = 0, blue = 0;
    uint8_t brightness = 0;
    int led_pin = 18;
    int led_dma = 10;
    int led_count = 220;


    static struct option long_options[] = {
        {"power", required_argument, 0, 'P'},
        {"color", required_argument, 0, 'c'},
        {"brightness", required_argument, 0, 'B'},
        {"led-pin", required_argument, 0, 'p'},
        {"led-dma", required_argument, 0, 'd'},
        {"led-count", required_argument, 0, 'c'},
        {0, 0, 0, 0}
    };

    int option_index = 0;
    int opt;
    while ((opt = getopt_long(argc, argv, "P:r:g:b:B:p:d:c:", long_options, &option_index)) != -1) {
        switch (opt) {
            case 'P':
                power = optarg;
                break;
            case 'c':
                if (sscanf(optarg, "#%2x%2x%2x", &red, &green, &blue) != 3) {
                    fprintf(stderr, "Ungültige Farbe: %s\n", optarg);
                    return 1;
                }
                break;
            case 'B':
                brightness = (uint8_t)atoi(optarg);
                break;
            case 'p':
                led_pin = atoi(optarg);
                break;
            case 'd':
                led_dma = atoi(optarg);
                break;
            case 'c':
                led_count = atoi(optarg);
                break;
            default:
                printf("%d mit Wert %s unbekannt\n", opt, optarg);
                break;
        }
    }

    ws2811_t strip = {
        .freq = WS2811_TARGET_FREQ,
        .dmanum = led_dma,
        .channel = {
            [0] = { .gpionum = led_pin, .count = led_count, .invert = 0, .brightness = brightness, .strip_type = LED_STRIP },
            [1] = { .gpionum = 0, .count = 0, .invert = 0, .brightness = 0 },
        },
    };

    ws2811_return_t ret = ws2811_init(&strip);
    if(ret != WS2811_SUCCESS) {
        fprintf(stderr, "ws2811_init failed: %s\n", ws2811_get_return_t_str(ret));
        return EXIT_FAILURE;
    }

    if(strcmp(power, "on") != 0) {
        for(int i = 0; i < led_count; i++) {
            strip.channel[0].leds[i] = 0;
        }
        ws2811_render(&strip);
        ws2811_wait(&strip);

        printf("%d LEDS ausgeschaltet", led_count);

    } else {
        ws2811_led_t color = ((uint32_t)red << 16) | ((uint32_t)green << 8) | blue;

        for(int i = 0; i < led_count; i++) {
            strip.channel[0].leds[i] = color;
        }
        ws2811_render(&strip);
        ws2811_wait(&strip);

        printf("%d LEDS auf RGB(%d, %d, %d) gesetzt", led_count, red, green, blue);
    }

    ws2811_fini(&strip);

    return 0;
}