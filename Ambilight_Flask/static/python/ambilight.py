import multiprocessing as mp
import board
import neopixel
import time
import numpy as np
import cv2
import json



# LED configuration
with open("/home/luca/Ambilight_Flask/static/config.json", "r") as file:
    nested_data = json.load(file)

data = nested_data["Ambilight"]

LED_COUNT_LEFT = data["count_left"]
LED_COUNT_TOP = data["count_top"]
LED_COUNT_RIGHT = data["count_right"]
LED_COUNT_BOTTOM = data["count_bottom"]
LED_COUNT = LED_COUNT_BOTTOM + LED_COUNT_RIGHT + LED_COUNT_TOP + LED_COUNT_LEFT
LED_BRIGHTNESS = data["brightness"]
LED_OFFSET = data["offset"]
PIN = board.D18

WAIT = 0.0016

#Always update LED configuratiosn from JSON
#def update_variables():
#    while True:
#        try:
#            with open("/home/luca/Ambilight_Flask/static/config.json", "r") as file:
#                data = json.load(file)["Ambilight"]
#
#
#            global LED_COUNT_LEFT, LED_COUNT_TOP, LED_COUNT_RIGHT, LED_COUNT_BOTTOM, LED_COUNT, LED_BRIGHTNESS, LED_OFFSET
#            LED_COUNT_LEFT = data["count_left"]
#            LED_COUNT_TOP = data["count_top"]
#            LED_COUNT_RIGHT = data["count_right"]
#            LED_COUNT_BOTTOM = data["count_bottom"]
#            LED_COUNT = LED_COUNT_BOTTOM + LED_COUNT_RIGHT + LED_COUNT_TOP + LED_COUNT_LEFT
#            LED_BRIGHTNESS = data["brightness"]
#            LED_OFFSET = data["offset"]
#        except KeyboardInterrupt:
#            pixels.fill((0,0,0))
#            pixels.show()
#            exit()



# turns a bgr color a rgb color
def bgr_to_rgb(colors):
    colors[:, [0, 2]] = colors[:, [2, 0]]
    return colors



old_pixels = [[0,0,0]] * LED_COUNT
new_pixels = [[0,0,0]] * LED_COUNT



# Initialize NeoPixel object
pixels = neopixel.NeoPixel(PIN, LED_COUNT, brightness=1, auto_write=False)



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
def get_dominant_color(q_in, q_out):
    while True:
        try:
            frame = q_in.get()
            resized_left = cv2.resize(frame, (9, LED_COUNT_LEFT), interpolation=cv2.INTER_NEAREST)
            resized_top = cv2.resize(frame, (LED_COUNT_TOP, 9), interpolation=cv2.INTER_NEAREST)
            resized_right = cv2.resize(frame, (9, LED_COUNT_RIGHT), interpolation=cv2.INTER_NEAREST)
            resized_bottom = cv2.resize(frame, (LED_COUNT_BOTTOM, 9), interpolation=cv2.INTER_NEAREST)
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
def calc_color_arr(q_in, q_out):
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

            new_pixels[:LED_COUNT_LEFT] = colors_left[:, 1][::-1]
            new_pixels[LED_COUNT_LEFT:LED_COUNT_LEFT+LED_COUNT_TOP] = colors_top[1, :]
            new_pixels[LED_COUNT_LEFT+LED_COUNT_TOP:LED_COUNT_LEFT+LED_COUNT_TOP+LED_COUNT_RIGHT] = colors_right[:, 7]
            new_pixels[LED_COUNT_LEFT+LED_COUNT_TOP+LED_COUNT_RIGHT:LED_COUNT_LEFT+LED_COUNT_TOP+LED_COUNT_RIGHT+LED_COUNT_BOTTOM] = colors_bottom[7, :][::-1]

            new_pixels = np.array(new_pixels)
            new_pixels = bgr_to_rgb(new_pixels)

#            for i in range(LED_COUNT):
#                #LEDS for right side
#                if(i >= LED_COUNT_LEFT+LED_COUNT_TOP+LED_COUNT_RIGHT):
#                    color = colors_bottom[7, (LED_COUNT_BOTTOM-1) - (i - (LED_COUNT_LEFT+LED_COUNT_TOP+LED_COUNT_RIGHT))]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
#                elif(i >= LED_COUNT_LEFT+LED_COUNT_TOP):
#                    color = colors_right[i - (LED_COUNT_LEFT+LED_COUNT_TOP), 7]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
#                elif(i >= LED_COUNT_LEFT):
#                    color = colors_top[1, i - LED_COUNT_LEFT]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
#                else:
#                    color = colors_left[(LED_COUNT_LEFT-1) - i, 1]
#                    new_pixels[i] = bgr_to_rgb(color.tolist())  # Pass as list
            q_out.put(new_pixels)
        except Exception:
            pixels.fill((0,0,0))
            pixels.show()
            exit()
        except mp.queues.Empty:
            pass

#make color transitions smooth + darker colors are made even darker
def get_smooth_color(q, ratio=0.7):
    while True:
        try:
            c1 = old_pixels
            c2 = q.get()
            c2 = c2*(np.power(np.mean(c2, axis=1, keepdims=True)/255, 0.2))*LED_BRIGHTNESS
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


# starts all processes
if __name__ == "__main__":
    print("Started Ambilight")

    # queue elements
    q_screen = mp.Queue()
    q_colors = mp.Queue()
    q_new_colors = mp.Queue()

    # processes
    p_get_screen = mp.Process(target=get_screen, args=(q_screen,))
    p_dominant_colors = mp.Process(target=get_dominant_color, args=(q_screen, q_colors))
    p_calc_color_arr = mp.Process(target=calc_color_arr, args=(q_colors, q_new_colors))
    p_smooth_colors = mp.Process(target=get_smooth_color, args=(q_new_colors,))
    p_update_variables = mp.Process(target=update_variables)

    # start of process
    p_get_screen.start()
    p_dominant_colors.start()
    p_calc_color_arr.start()
    p_smooth_colors.start()
    p_update_variables.start()

    print("Started Update Variables with PID {p_update_variables.pid}")
    print("Started Get Screen with PID {p_get_screen.pid}")
    print("Started Get Dominant Colors with PID {p_dominant_colors.pid}")
    print("Started Calculate Color Array with PID {p_calc_color_arr.pid}")
    print("Started Smooth Colors with PID {p_smooth_colors.pid}")

    # order in which processes get started
    p_update_variables.join()
    p_get_screen.join()
    p_dominant_colors.join()
    p_calc_color_arr.join()
    p_smooth_colors.join()
