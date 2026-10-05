CC     ?= gcc
CFLAGS ?= -O2 -Wall -Wextra
LDLIBS  = -lws2811 -lm

PROGRAMS = ambilight static_color color_flow

all: $(PROGRAMS)

# jedes Programm besteht aus seiner eigenen Datei und dem gemeinsamen leds.c
$(PROGRAMS): %: %.c leds.c leds.h
	$(CC) $(CFLAGS) -o $@ $*.c leds.c $(LDLIBS)

clean:
	rm -f $(PROGRAMS)

.PHONY: all clean
