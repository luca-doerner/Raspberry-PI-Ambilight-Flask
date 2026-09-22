CC     ?= gcc
CFLAGS ?= -O2 -Wall -Wextra
LDLIBS  = -lws2811 -lm

all: ambilight static_color

static_color: static_color.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

ambilight: ambilight.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f ambilight
	rm -f static_color

.PHONY: clean
