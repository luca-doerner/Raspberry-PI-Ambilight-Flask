#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <getopt.h>
#include <signal.h>
#include "leds.h"      // eigene Header mit "…", System-Header mit <…>

volatile sig_atomic_t running = 1;

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

// schaltet die LEDs aus (schwarz); das Aufräumen macht der Aufrufer mit ws2811_fini
void leds_off(ws2811_t *strip) {
    memset(strip->channel[0].leds, 0, strip->channel[0].count * sizeof(ws2811_led_t));
    ws2811_render(strip);
    ws2811_wait(strip);
}

led_config_t load_config(int argc, char *argv[]) {
    // Startwerte, falls eine Einstellung nicht übergeben wird
    led_config_t config = {
        .led_count_left = 0,
        .led_count_top = 0,
        .led_count_right = 0,
        .led_count_bottom = 0,
        .led_pin = DEFAULT_LED_PIN,
        .led_dma = DEFAULT_LED_DMA,
    };

    // Namen mit Unterstrich: genau so heißen die Einstellungen in der Datenbank
    static struct option long_options[] = {
        {"led_count_left", required_argument, 0, OPT_LED_COUNT_LEFT},
        {"led_count_top", required_argument, 0, OPT_LED_COUNT_TOP},
        {"led_count_right", required_argument, 0, OPT_LED_COUNT_RIGHT},
        {"led_count_bottom", required_argument, 0, OPT_LED_COUNT_BOTTOM},
        {"led_pin", required_argument, 0, OPT_LED_PIN},
        {"led_dma", required_argument, 0, OPT_LED_DMA},
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

// the feature settings from the command line (--brightness=70 ...), the device settings are
// already read by load_config; unknown settings of other features are ignored
void load_settings(int argc, char *argv[], int setting_count, const char *setting_names[], int (*set_setting)(const char *name, const char *value)) {
    struct option options[setting_count + 1];
    for (int i = 0; i < setting_count; i++)
        options[i] = (struct option){ setting_names[i], required_argument, 0, OPT_SETTING_BASE + i };
    options[setting_count] = (struct option){ 0, 0, 0, 0 };

    opterr = 0;
    int opt;
    while ((opt = getopt_long(argc, argv, "", options, NULL)) != -1) {
        int index = opt - OPT_SETTING_BASE;
        if (index >= 0 && index < setting_count && !set_setting(setting_names[index], optarg))
            fprintf(stderr, "Ungültiger Wert für %s: %s\n", setting_names[index], optarg);
    }
    optind = 1;   // damit weitere Durchläufe wieder von vorn anfangen
}

void init_socket(int *s) {
    *s = socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(UDP_PORT),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK)
    };
    if (*s < 0 || bind(*s, (struct sockaddr *)&addr, sizeof addr) < 0)
        fprintf(stderr, "UDP-Port %d nicht verfügbar, Einstellungen kommen nur beim Start an\n", UDP_PORT);
}

void poll_settings(int *s, int (*set_setting)(const char *name, const char *value)) {
    ssize_t n;
    char sock_buf[64];
    while ((n = recv(*s, sock_buf, sizeof sock_buf - 1, 0)) > 0) {
        sock_buf[n] = '\0';
        char name[32];
        char value[32];
        if (sscanf(sock_buf, "%31[a-z_]: %31s", name, value) == 2 && set_setting(name, value))
            printf("Einstellung übernommen: %s = %s\n", name, value);
        else
            printf("Unbekannte oder ungültige Einstellung: %s\n", sock_buf);
    }
}

void on_signal(int sig) {
    (void)sig;
    running = 0;
}

void init_signals(void) {
    struct sigaction sa = { .sa_handler = on_signal };
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
}

int get_running(void) {
    return running;
}