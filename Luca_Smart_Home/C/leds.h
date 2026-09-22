#ifndef LEDS_H          // Include-Wächter: verhindert doppeltes Einlesen
#define LEDS_H
#define LED_STRIP               WS2811_STRIP_GRB

#define OPT_LED_COUNT_LEFT      1001
#define OPT_LED_COUNT_TOP       1002
#define OPT_LED_COUNT_RIGHT     1003
#define OPT_LED_COUNT_BOTTOM    1004
#define OPT_LED_PIN             1005
#define OPT_LED_DMA             1006

#include <stdint.h>
#include <ws2811/ws2811.h>

typedef struct {
    int led_count;
    int led_count_left; 
    int led_count_top; 
    int led_count_right; 
    int led_count_bottom; 
    int led_pin; 
    int led_dma;
} led_config_t;

// richtet den Streifen ein, gibt 0 zurück bei Erfolg
int leds_init(ws2811_t *strip, int led_count, int led_pin, int led_dma, int brightness);

// setzt alle LEDs auf eine Farbe und schickt sie raus
void leds_fill(ws2811_t *strip, uint8_t red, uint8_t green, uint8_t blue);

// alle LEDs aus und aufräumen
void leds_off(ws2811_t *strip);

// lädt die komplette gerätekonfig
led_config_t load_config(int argc, char *argv[]);

#endif