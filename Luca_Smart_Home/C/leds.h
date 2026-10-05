#ifndef LEDS_H          // Include-Wächter: verhindert doppeltes Einlesen
#define LEDS_H
#define LED_STRIP               WS2811_STRIP_GRB

// gelten, solange nichts anderes übergeben wird
#define DEFAULT_LED_PIN         18
#define DEFAULT_LED_DMA         10

#define OPT_LED_COUNT_LEFT      1001
#define OPT_LED_COUNT_TOP       1002
#define OPT_LED_COUNT_RIGHT     1003
#define OPT_LED_COUNT_BOTTOM    1004
#define OPT_LED_PIN             1005
#define OPT_LED_DMA             1006

#define OPT_SETTING_BASE 3001

#define UDP_PORT         9000           // the server sends the live settings here

#include <signal.h>          // sig_atomic_t für running
#include <stdint.h>
#include <ws2811/ws2811.h>
#include <sys/socket.h>
#include <arpa/inet.h>

typedef struct {
    int led_count;
    int led_count_left; 
    int led_count_top; 
    int led_count_right; 
    int led_count_bottom; 
    int led_pin; 
    int led_dma;
} led_config_t;

typedef struct { uint8_t r, g, b; } rgb_t;

typedef int (*setting_callback_t)(const char *name, const char *value);

extern volatile sig_atomic_t running;

// richtet den Streifen ein, gibt 0 zurück bei Erfolg
int leds_init(ws2811_t *strip, int led_count, int led_pin, int led_dma, int brightness);

// setzt alle LEDs auf eine Farbe und schickt sie raus
void leds_fill(ws2811_t *strip, uint8_t red, uint8_t green, uint8_t blue);

// alle LEDs aus (schwarz); danach noch ws2811_fini aufrufen
void leds_off(ws2811_t *strip);

// lädt die komplette gerätekonfig
led_config_t load_config(int argc, char *argv[]);

void load_settings(int argc, char *argv[], int setting_count, const char *setting_names[], setting_callback_t callback);

// öffnet den UDP-Port für die Live-Einstellungen und schreibt den Socket nach *s
void init_socket(int *s);

void poll_settings(int *s, setting_callback_t callback);

void on_signal(int sig);

void init_signals(void);

int get_running(void);

#endif