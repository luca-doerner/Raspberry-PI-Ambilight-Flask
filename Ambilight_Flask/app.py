from flask import Flask, render_template, Response, jsonify, request
from appConfig import Config
import json

app = Flask(__name__)
app.config.from_object(Config)
PORT = app.config["PORT"]
DEBUG = app.config["DEBUG"]

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

if __name__ == "__main__":
    app.run(
        debug=DEBUG,
        port=PORT
        )