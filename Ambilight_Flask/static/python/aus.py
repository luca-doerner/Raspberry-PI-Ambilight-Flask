import board
import neopixel
import json
import os

# LED configuration
with open("../config.json", "r") as file:
    nested_data = json.load(file)

data = nested_data["Ambilight"]

LED_COUNT_LEFT = data["count_left"]
LED_COUNT_TOP = data["count_top"]
LED_COUNT_RIGHT = data["count_right"]
LED_COUNT_BOTTOM = data["count_bottom"]
LED_COUNT = LED_COUNT_BOTTOM + LED_COUNT_RIGHT + LED_COUNT_TOP + LED_COUNT_LEFT
PIN = board.D18

# Initialize NeoPixel object
pixels = neopixel.NeoPixel(PIN, LED_COUNT, brightness=1, auto_write=False)

pixels.fill((0,0,0))
pixels.show()
exit