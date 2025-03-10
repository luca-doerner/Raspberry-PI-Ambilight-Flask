from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
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

################ Constants #################################################################
FLASK_BASE_PATH = os.getenv("FLASK_BASE_PATH")

MODE = ""
CONFIG_URL = "http://localhost:5000/get-config"
CONFIG_PATH = "FLASK_BASE_PATH/Ambilight_Flask/static/config.json"




################ Helper Functions #####################################################################




################ Processes #####################################################################




################ Main Function #####################################################################
# starts all processes
if __name__ == "__main__":


################ Configurations #####################################################################
    manager = mp.Manager()
    shared_dict = manager.dict()

    # LED configuration
    config = Config(MODE, CONFIG_URL, CONFIG_PATH, shared_dict)
    observer = Observer()
    observer.schedule(config, CONFIG_PATH, recursive=False)

    PIN = board.D18

    WAIT = 0.0016

    # Initialize NeoPixel object
    pixels = neopixel.NeoPixel(PIN, config.get("led_count"), brightness=1, auto_write=False)


    # queue elements

    # processes

    # start of process

    # order in which processes get started