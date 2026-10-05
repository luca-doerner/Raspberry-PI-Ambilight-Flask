/*
 * color_flow.c - Feature-Art "service": schiebt der Reihe nach die Farben der Liste vorne in den
 * Streifen, sie wandern dann wie ein Lauflicht nach hinten.
 *
 * Einstellungen kommen vom Server:
 *   beim Start als --name=wert (Geräte-Einstellungen über load_config aus leds.c),
 *   im Betrieb als UDP-Nachricht "name: wert".
 *   colors     Farben als Liste, z. B. --colors=#ff0000,#00ff00,#0000ff
 *   speed      Abstand zwischen zwei Schritten in Millisekunden
 *   brightness Helligkeit in Prozent
 *
 * Bauen: make
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "leds.h"

#define MAX_COLORS 20
#define FRAME_US   20000   // alle 20 ms nachsehen, ob ein Schritt fällig ist

static rgb_t colors[MAX_COLORS] = { { 255, 255, 255 } };
static int color_count = 1;
static int speed_ms = 1000;
static double brightness = 0.7;

// wird gesetzt, wenn sich etwas geändert hat und die LEDs neu geschrieben werden müssen
static int needs_render = 1;
// die Farbe, die als nächstes vorne eingeschoben wird
static int next_color = 0;

static const char *SETTING_NAMES[] = {
    "colors", "speed", "brightness"
};

// #define statt const int: der Wert wird als Array-Größe gebraucht
#define SETTING_COUNT ((int)(sizeof SETTING_NAMES / sizeof *SETTING_NAMES))

/*************** Einstellungen ****************************************************************/
// "#ff0000,#00ff00" -> colors; erst bei Erfolg übernommen, eine kaputte Nachricht lässt die
// laufende Animation also in Ruhe; 0 = ungültig
static int parse_colors(const char *text) {
    rgb_t neu[MAX_COLORS];
    int count = 0;

    // strtok_r zerschneidet den Text, deshalb auf einer Kopie arbeiten
    char kopie[SETTING_VALUE_MAX];
    if (strlen(text) >= sizeof kopie)
        return 0;
    snprintf(kopie, sizeof kopie, "%s", text);

    char *rest = NULL;
    for (char *teil = strtok_r(kopie, ",", &rest); teil; teil = strtok_r(NULL, ",", &rest)) {
        if (count >= MAX_COLORS)
            return 0;
        // das Leerzeichen im Format erlaubt auch "#ff0000, #00ff00"
        if (sscanf(teil, " #%2hhx%2hhx%2hhx", &neu[count].r, &neu[count].g, &neu[count].b) != 3)
            return 0;
        count++;
    }
    if (count == 0)
        return 0;

    memcpy(colors, neu, (size_t)count * sizeof *neu);
    color_count = count;
    next_color = 0;      // die alte Position gibt es in der neuen Liste vielleicht nicht mehr
    return 1;
}

// nimmt eine Einstellung an, 0 = unbekannt oder ungültig
static int set_setting(const char *name, const char *value) {
    if (strcmp(name, "colors") == 0) {
        if (!parse_colors(value))
            return 0;
    } else if (strcmp(name, "speed") == 0) {
        int number = atoi(value);
        if (number < 1)
            return 0;
        speed_ms = number;
    } else if (strcmp(name, "brightness") == 0) {
        int number = atoi(value);
        if (number < 0 || number > 100)
            return 0;
        brightness = number / 100.0;
    } else {
        return 0;
    }
    needs_render = 1;    // die Helligkeit gilt sofort für den ganzen Streifen
    return 1;
}

/*************** Animation ********************************************************************/
// CLOCK_MONOTONIC läuft stetig vorwärts, auch wenn die Uhrzeit gestellt wird
static long now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000L + t.tv_nsec / 1000000L;
}

// alles um eine LED nach hinten schieben und vorne die nächste Farbe einsetzen
static void step(rgb_t pixels[], int led_count) {
    memmove(&pixels[1], &pixels[0], (size_t)(led_count - 1) * sizeof *pixels);
    pixels[0] = colors[next_color];
    next_color = (next_color + 1) % color_count;
}

// Farben mit der Helligkeit in den LED-Puffer schreiben
static void render(ws2811_t *strip, const rgb_t pixels[], int led_count) {
    for (int i = 0; i < led_count; i++) {
        uint8_t r = (uint8_t)(pixels[i].r * brightness);
        uint8_t g = (uint8_t)(pixels[i].g * brightness);
        uint8_t b = (uint8_t)(pixels[i].b * brightness);
        strip->channel[0].leds[i] = ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
    }
    ws2811_render(strip);
}

/*************** Main *************************************************************************/
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

    rgb_t pixels[config.led_count];
    memset(pixels, 0, sizeof pixels);

    ws2811_t strip;
    if (leds_init(&strip, config.led_count, config.led_pin, config.led_dma, 255) < 0)
        return EXIT_FAILURE;
    // der Server schickt die Einstellungen per UDP, sobald diese Zeile kommt
    printf("Started Color Flow (%d LEDs)\n", config.led_count);

    long last_step = now_ms();
    while (get_running()) {
        poll_settings(&s, set_setting);

        // nur schieben, wenn der Abstand um ist; bei Verzug mehrere Schritte auf einmal
        int steps = 0;
        while (now_ms() - last_step >= speed_ms) {
            step(pixels, config.led_count);
            last_step += speed_ms;
            needs_render = 1;
            // mehr Schritte als LEDs bringen nichts, der Streifen ist dann schon ganz neu;
            // das begrenzt das Nachholen, wenn speed stark verkleinert wurde
            if (++steps >= config.led_count) {
                last_step = now_ms();
                break;
            }
        }

        // zwischen zwei Schritten ändert sich nichts, dann spart man sich das Senden
        if (needs_render) {
            render(&strip, pixels, config.led_count);
            needs_render = 0;
        }

        usleep(FRAME_US);
    }

    leds_off(&strip);
    ws2811_fini(&strip);
    return EXIT_SUCCESS;
}
