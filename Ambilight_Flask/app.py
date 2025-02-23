from flask import Flask, render_template, Response, jsonify, request
from appConfig import Config
import json
import subprocess

app = Flask(__name__)
app.config.from_object(Config)
PORT = app.config["PORT"]
DEBUG = app.config["DEBUG"]
HOST = app.config["HOST"]


############## HTML ###################################################################
@app.route("/")
def home():
    return render_template("home.html")

@app.route("/ambilight")
def ambilight():
    return render_template("ambilight.html")

@app.route("/staticColor")
def staticColor():
    return render_template("staticColor.html")

@app.route("/loading")
def loading():
    return render_template("loading.html")

@app.route("/error")
def error():
    return render_template("error.html")


############## Config #################################################################
@app.route("/get-config", methods=["GET"])
def getConfig():
    try:
        with open("static/config.json") as file:
            data = json.load(file)
        
        return Response(json.dumps(data), mimetype=("application/json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/set-config", methods=["POST"])
def setConfig():
    try:
        new_data = request.json

        with open("static/config.json", "r") as file:
            data = json.load(file)

        for key, value in new_data.items():
            data[key] = value

        with open("static/config.json", "w") as file:
            json.dump(data, file, indent=4)       
        
        return jsonify({"message": "Data updated successfully!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
############## Python control ##########################################################
def power(startscript, stopscript, new_power):
    try:
        subprocess.run(["bash", "static/sh/" + stopscript], text=True, check=True)

        if(new_power["power"] == "on"):
            process = subprocess.Popen(
                ["bash", "static/sh/" + startscript],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            # Read and print output in real-time
            for line in process.stdout:
                print(line.strip())  # Show live output

            process.wait()  # Wait for the process to complete

            stdout = process.stdout.read()

            if "Done:" not in stdout:
                raise Exception(stdout)


        return jsonify({"message": "Successfully started python script!"}), 200
    except Exception as e:
        return jsonify({"error": "Error while starting Python script!", "details": str(e)}), 300

@app.route("/power/ambilight", methods=["POST"])
def power_ambilight():
    new_power = request.json

    return power("startAmbilight.sh", "stopAmbilight.sh", new_power)


@app.route("/power/staticColor", methods=["POST"])
def power_staticColor():
    start = "moin"
    try:
        raise Exception("moin")

        return jsonify({"message": "Successfully started python script!"}), 200
    except Exception as e:
        return jsonify({"error": "Moin while starting Python script!", "details": str(start)}), 300

if __name__ == "__main__":
    app.run(
        debug=DEBUG,
        port=PORT,
        host=HOST
        )