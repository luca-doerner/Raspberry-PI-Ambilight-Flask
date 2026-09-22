CC     ?= gcc
CFLAGS ?= -O2 -Wall -Wextra
LDLIBS  = -lws2811 -lm

all: ambilight static_color

ambilight: ambilight.c leds.c leds.h
	$(CC) $(CFLAGS) -o $@ ambilight.c leds.c $(LDLIBS)

static_color: static_color.c leds.c leds.h
	$(CC) $(CFLAGS) -o $@ static_color.c leds.c $(LDLIBS)

clean:
	rm -f ambilight static_color

.PHONY: all clean