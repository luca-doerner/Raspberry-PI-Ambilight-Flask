from watchdog.observers import Observer
import multiprocessing as mp
import board
import neopixel
import time
import numpy as np
import cv2
import json
import os
import requests
from config import Config

################ Global Variables #################################################################
MODE = "Ambilight"
CONFIG_URL = "http://localhost:5000/get-config"
CONFIG_PATH = "/home/luca/Ambilight_Flask/static/config.json"

#Always update LED configuratiosn from JSON
#def update_variables():
#    while True:
#        try:
#            with open("/home/luca/Ambilight_Flask/static/config.json", "r") as file:
#                data = json.load(file)["Ambilight"]
#
#
#            global config.get("count_left"), config.get("count_top"), config.get("count_right"), config.get("count_bottom"), LED_COUNT, config.get("brightness"), config.get("offset")
#            config.get("count_left") = data["count_left"]
#            config.get("count_top") = data["count_top"]
#            config.get("count_right") = data["count_right"]
#            config.get("count_bottom") = data["count_bottom"]
#            LED_COUNT = config.get("count_bottom") + config.get("count_right") + config.get("count_top") + config.get("count_left")
#            config.get("brightness") = data["brightness"]
#            config.get("offset") = data["offset"]
#        except KeyboardInterrupt:
#            pixels.fill((0,0,0))
#            pixels.show()
#            exit()

################ Helper Functions #####################################################################
# turns a bgr color a rgb color
def bgr_to_rgb(colors):
    colors[:, [0, 2]] = colors[:, [2, 0]]
    return colors



################ Processes #####################################################################
# Process for getting the screen via a Screenshot
def get_screen(q):
    while True:
        try:
            ret, frame = cap.read()
            if not ret:
                print("Kein HDMI-Signal!")
                exit()
            q.put(frame)
            time.sleep(WAIT)
        except Exception:
            pixels.fill((0,0,0))
            pixels.show()
            exit()



# Process for resizing the captured screenshot into 4 different small 
# pictures for all sides, so it gets the dominant color
def get_dominant_color(q_in, q_out, config):
    while True:
        try:
            frame = q_in.get()
            resized_left = cv2.resize(frame, (9, config.get("count_left")), interpolation=cv2.INTER_NEAREST)
            resized_top = cv2.resize(frame, (config.get("count_top"), 9), interpolation=cv2.INTER_NEAREST)
            resized_right = cv2.resize(frame, (9, config.get("count_right")), interpolation=cv2.INTER_NEAREST)
            resized_bottom = cv2.resize(frame, (config.get("count_bottom"), 9), interpolation=cv2.INTER_NEAREST)
            resized = [resized_left, resized_top, resized_right, resized_bottom]
            q_out.put(resized)
            time.sleep(WAIT)
        except Exception:
            pixels.fill((0,0,0))
            pixels.show()
            exit()
        except mp.queues.Empty:
            pass



# updates all the LEDS with the new "smooth" color
def calc_color_arr(q_in, q_out, config):
    """ LEDs aktualisieren """
    while True:
        try:
            global old_pixels, new_pixels

            colors = q_in.get()
            if(np.mean(colors[0]) <= 0.5):
                old_pixels=[[0,0,0]] * LED_COUNT

            colors_left = colors[0]
            colors_top = colors[1]
            colors_right = colors[2]
            colors_bottom = colors[3]

            new_pixels[:config.get("count_left")] = colors_left[:, 1][::-1]
            new_pixels[config.get("count_left"):config.get("count_left")+config.get("count_top")] = colors_top[1, :]
            new_pixels[config.get("count_left")+config.get("count_top"):config.get("count_left")+config.get("count_top")+config.get("count_right")] = colors_right[:, 7]
            new_pixels[config.get("count_left")+config.get("count_top")+config.get("count_right"):config.get("count_left")+config.get("count_top")+config.get("count_right")+config.get("count_bottom")] = colors_bottom[7, :][::-1]

            new_pixels = np.array(new_pixels)
            new_pixels = bgr_to_rgb(new_pixels)

#            for i in range(LED_COUNT):
#                #LEDS for right side
#                if(i >= config.get("count_left")+config.get("count_top")+config.get("count_right")):
#                    color = colors_bottom[7, (config.get("count_bottom")-1) - (i - (config.get("count_left")+config.get("count_top")+config.get("count_right")))]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
#                elif(i >= config.get("count_left")+config.get("count_top")):
#                    color = colors_right[i - (config.get("count_left")+config.get("count_top")), 7]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
#                elif(i >= config.get("count_left")):
#                    color = colors_top[1, i - config.get("count_left")]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
#                else:
#                    color = colors_left[(config.get("count_left")-1) - i, 1]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
            q_out.put(new_pixels)
        except Exception:
            pixels.fill((0,0,0))
            pixels.show()
            exit()
        except mp.queues.Empty:
            pass

#make color transitions smooth + darker colors are made even darker
def get_smooth_color(q, config, ratio=0.7):
    while True:
        try:
            c1 = old_pixels
            c2 = q.get()
            c2 = c2*(np.power(np.mean(c2, axis=1, keepdims=True)/255, 0.2))*config.get("brightness")
            smooth_color = np.rint(np.array(c1)*ratio + np.array(c2)*(1-ratio)).astype(int).tolist()
            pixels[:] = smooth_color
            old_pixels[:] = pixels
            pixels.show()
        except Exception:
            pixels.fill((0,0,0))
            pixels.show()
            exit()
        except mp.queues.Empty:
            pass



################ Main Function #####################################################################
# starts all processes
if __name__ == "__main__":
    # Initialize Capture Device
    capture_device = 0
    cap = cv2.VideoCapture(capture_device, cv2.CAP_V4L2)

    if not cap.isOpened():
        print(f"Fehler: HDMI-Capture-Device {capture_device} nicht gefunden!")

        capture_device = 1
        cap = cv2.VideoCapture(capture_device, cv2.CAP_V4L2)

        if not cap.isOpened():
            print(f"Fehler: HDMI-Capture-Device {capture_device} nicht gefunden!")
            exit()

    print("Started " + MODE)

################ Configurations #####################################################################
    manager = mp.Manager()
    shared_dict = manager.dict()

    # LED configuration
    config = Config(MODE, CONFIG_URL, CONFIG_PATH, shared_dict)
    observer = Observer()
    observer.schedule(config, CONFIG_PATH, recursive=False)

    LED_COUNT = config.get("count_bottom") + config.get("count_right") + config.get("count_top") + config.get("count_left")
    PIN = board.D18

    WAIT = 0.0016

    old_pixels = [[0,0,0]] * LED_COUNT
    new_pixels = [[0,0,0]] * LED_COUNT

    # Initialize NeoPixel object
    pixels = neopixel.NeoPixel(PIN, LED_COUNT, brightness=1, auto_write=False)


    # queue elements
    q_screen = mp.Queue()
    q_colors = mp.Queue()
    q_new_colors = mp.Queue()

    # processes
    p_get_screen = mp.Process(target=get_screen, args=(q_screen,))
    p_dominant_colors = mp.Process(target=get_dominant_color, args=(q_screen, q_colors, config))
    p_calc_color_arr = mp.Process(target=calc_color_arr, args=(q_colors, q_new_colors, config))
    p_smooth_colors = mp.Process(target=get_smooth_color, args=(q_new_colors, config))
#    p_update_variables = mp.Process(target=update_variables)

    # start of process
    p_get_screen.start()
    p_dominant_colors.start()
    p_calc_color_arr.start()
    p_smooth_colors.start()
    observer.start()
#    p_update_variables.start()

#    print("Started Update Variables with PID {p_update_variables.pid}")
    print(f"Started Get Screen with PID {p_get_screen.pid}")
    print(f"Started Get Dominant Colors with PID {p_dominant_colors.pid}")
    print(f"Started Calculate Color Array with PID {p_calc_color_arr.pid}")
    print(f"Started Smooth Colors with PID {p_smooth_colors.pid}")

    # order in which processes get started
#    p_update_variables.join()
    observer.join()
    p_get_screen.join()
    p_dominant_colors.join()
    p_calc_color_arr.join()
    p_smooth_colors.join()