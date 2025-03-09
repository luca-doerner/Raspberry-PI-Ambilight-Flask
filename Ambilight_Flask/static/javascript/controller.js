import { Config } from "./config.js"

export class Controller{
    constructor(mode, pages, configValues, sliders, sliderTextFields){
        this.mode = mode
        this.pages = pages
        this.configValues = configValues
        this.sliders = sliders
        this.sliderTextFields = sliderTextFields
        this.config = new Config(this)
    }

    //////////////////////// Helper Functions ///////////////////////////////////////////////////////////
    textToSlider(element){
        let textField = element.srcElement
        let parentDiv = textField.parentElement.parentElement
        
        let slider = parentDiv.children[1]
        
        slider.value = textField.value;
    }
    
    sliderToText(element){
        let slider = element.srcElement
        let parentDiv = slider.parentElement
    
        let textField = parentDiv.children[2].children[0]
    
        textField.value = slider.value;
    }

    showPage(page){
        this.pages.forEach(element => {
            if(element === page){
                element.style.display = "grid"
            } else {
                element.style.display = "none"
            }
        });
    }

    //////////////////////// Fetch Functions ///////////////////////////////////////////////////////////
    async loadProgramConfig(){
        return new Promise((resolve, reject) => {
            let timeoutReached = false;

            // Set a timeout to trigger after 3 seconds
            const timeout = setTimeout(() => {
                timeoutReached = true; // Mark timeout flag as true
                console.log("Loading the config took too long, which is unusual.");
                resolve(); // Resolve the promise even after timeout
            }, 3000);

            fetch("/get-config", {
                headers:{"Referer": this.config.json["name"] != null ? this.config.json["name"].toLowerCase : "undefined" + ".js"}
            })
                .then(response => {
                    if(response.status != 200){
                        throw new Error(response.json())
                    }
                    return response.json()
                })
                .then(newConfig => {
                    this.config.setConfigValuesInMemory(newConfig[this.mode])
                    console.log({"message": "Succesfully loaded " + this.config.json["name"] + " Config!", "data": this.config.json})
                    clearTimeout(timeout)
                    resolve()
                })
                .catch(error => {
                    console.log("Error while loading: " + error.error)
                    if(!timeoutReached){
                        clearTimeout(timeout)
                        reject(error)
                    }
                })
        })
    }

    async returnWholeConfig(){
        return new Promise((resolve, reject) => {
            let timeoutReached = false;

            // Set a timeout to trigger after 3 seconds
            const timeout = setTimeout(() => {
                timeoutReached = true; // Mark timeout flag as true
                console.log("Loading the config took too long, which is unusual.");
                resolve(); // Resolve the promise even after timeout
            }, 3000);

            fetch("/get-config", {
                headers:{"Referer": this.config.json["name"] != null ? this.config.json["name"].toLowerCase : "undefined" + ".js"}
            })
                .then(response => {
                    if(response.status != 200){
                        throw new Error(response.json())
                    }
                    return response.json()
                })
                .then(newConfig => {
                    console.log({"message": "Succesfully loaded Whole Config!", "data": newConfig})
                    clearTimeout(timeout)
                    resolve(newConfig)
                })
                .catch(error => {
                    console.log("Error while loading: " + error.error)
                    if(!timeoutReached){
                        clearTimeout(timeout)
                        reject(error)
                    }
                })
        })
    }

    async updateConfig(jsonBody){
        return new Promise((resolve, reject) => {
            let timeoutReached = false;

            // Set a timeout to trigger after 3 seconds
            const timeout = setTimeout(() => {
                timeoutReached = true; // Mark timeout flag as true
                console.log("Loading the config took too long, which is unusual.");
                resolve(); // Resolve the promise even after timeout
            }, 3000);

            fetch("/set-config", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Referer": this.config.json["name"] != null ? this.config.json["name"].toLowerCase : "undefined" + ".js"
                },
                body: JSON.stringify(jsonBody)
            })
                .then(response => {
                    if(response.status != 200){
                        throw new Error(response.json())
                    }
                    return response.json()
                })
                .then(data => {
                    console.log({"message": "Success: " + data.message, "data": jsonBody})
                    clearTimeout(timeout)
                    resolve()
                })
                .catch(error => {
                    console.log("Error while updating config: " + error.error)
                    if(!timeoutReached){
                        clearTimeout(timeout)
                        reject(error)
                    }
                })
        })
    }
}