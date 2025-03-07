import multiprocessing as mp
import time
import json
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import requests
import os
from config import Config

FLASK_BASE_PATH = os.getenv("FLASK_BASE_PATH")

MODE = "Ambilight"
CONFIG_URL = "http://localhost:5000/get-config"
CONFIG_PATH = FLASK_BASE_PATH + "/Ambilight_Flask/static/config.json"



def printCountLeft(shared_dict):
    while True:
        print(config.get("count_left"))
        jsonBody = {"all": shared_dict.getAll(), "count_left": shared_dict.get("count_left")}
        #requests.post("http://localhost:5000/print", json=jsonBody)
        time.sleep(3)


if __name__ == "__main__":
    print("Started")
    manager = mp.Manager()
    shared_dict = manager.dict()

    # LED configuration
    config = Config(MODE, CONFIG_URL, CONFIG_PATH, shared_dict)
    observer = Observer()
    observer.schedule(config, CONFIG_PATH, recursive=False)

    p_print = mp.Process(target=printCountLeft, args=(config,))

    p_print.start()
    observer.start()

    observer.join()
    p_print.join()
