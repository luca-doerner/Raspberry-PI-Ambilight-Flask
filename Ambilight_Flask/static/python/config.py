from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import json
import requests


################ Config Class #####################################################################
class Config(FileSystemEventHandler):
    def __init__(self, mode, url, path, shared_dict):
        self.mode = mode
        self.url = url
        self.path = path
        self.jsonBody = json.loads("{}")
        self.shared_dict = shared_dict
        self.updateValues()

    def get(self, field):
        try:
            return self.getAll().get(field, "Nicht gefunden")
        except Exception as e:
            print(e)

    def getAll(self):
        try:
            return self.shared_dict.get(self.mode, {})
        except Exception as e:
            print(e)

    def updateValues(self):
        try:
            response = requests.get(self.url, headers={"Referer": self.mode.lower() + ".py"})

            if(response.status_code == 200):
                self.shared_dict.update(response.json())
            else:
                print(f"Fehler: {response.json}")
                self.shared_dict.clear()
        except Exception as e:
            print(e)

    def getCurrentValuesFromJson(self):
        try:
            response = requests.get(self.url)

            if(response.status_code == 200):
                return response.json()
            else:
                print(f"Fehler: {response.json}")
                self.shared_dict.clear()
        except Exception as e:
            print(e)

    def on_modified(self, event):
        if event.src_path.endswith(self.path):
            new_config = self.getCurrentValuesFromJson()[self.mode]

            if(new_config != self.getAll()):
                print("Konfigurationsdatei geändert! Aktualisiere Werte...")
                self.updateValues()