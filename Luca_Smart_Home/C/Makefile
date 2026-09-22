CC     ?= gcc
CFLAGS ?= -O2 -Wall -Wextra
LDLIBS  = -lws2811 -lm

ambilight: ambilight.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f ambilight

.PHONY: clean
