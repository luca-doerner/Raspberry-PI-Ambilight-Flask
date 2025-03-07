class ConfigValues{
    constructor(){
        this.json = {
            "count_left": 0,
            "count_top": 0,
            "count_right": 0,
            "count_bottom": 0,
            "offset": 0,
            "brightness": 0.1,
            "strength_red": 0,
            "strength_green": 0,
            "strength_blue": 0,
            "strength_black": 0,
            "smoothness": 0
        }
    }

    async loadProgramConfigInMemory(){
        await loadProgramConfig()
    }

    setConfigValuesInMemory(name, count_left, count_top, count_right, count_bottom, offset, brightness, strength_red, strength_green, strength_blue, strength_black, smoothness){
        this.json = {
            "name": name,
            "count_left": count_left,
            "count_top": count_top,
            "count_right": count_right,
            "count_bottom": count_bottom,
            "offset": offset,
            "brightness": brightness,
            "strength_red": strength_red,
            "strength_green": strength_green,
            "strength_blue": strength_blue,
            "strength_black": strength_black,
            "smoothness": smoothness
        }
    }

    setConfigValuesInMemory(jsonBody){
        this.json = jsonBody
    }

    changeConfigValuesInMemory(jsonBody){
        Object.keys(jsonBody).forEach((key) => {
            this.json[key] = jsonBody[key]
        })
    }

    addLedCountToObjects(currentJson, wholeJson, ledCount, mode=null){
        let newJson = {}
        newJson["led_count"] = ledCount
        if(mode != null && mode == this.json["name"]){
            Object.keys(currentJson).forEach((key, value) => {
                newJson[key] = currentJson[key]
            })
        }
        Object.keys(wholeJson).forEach((key) => {
            let value = wholeJson[key]
            if (typeof value === "object" && !Array.isArray(value) && value !== null){
                newJson[key] = this.addLedCountToObjects(currentJson, value, ledCount, key)
            }
        })            

        return newJson
    }

    getLedCount(){
        let ledCount
        let summedLedCount = 0

        Object.keys(jsonBodyAll).forEach((key) => {
            if(key.startsWith("count_")){
                summedLedCount += jsonBodyAll[key]
            }
        })

        if(summedLedCount == 0){
            ledCount = jsonBodyAll[led_count]
        } else{
            ledCount = summedLedCount
        }

        return ledCount
    }

    async setConfigValuesInJson(){
        return new Promise((resolve, reject) => {
            let timeoutReached = false

            const timeout = setTimeout(() => {
                timeoutReached = true
                console.log("Loading the config took too long. Which is unusual.")
                resolve()
            })

            try
            {
                returnWholeConfig().then(async wholeConfig => {
                    let jsonBodyCurrent
                    await this.getOnlyCurrentChangedValues().then(currentConfig => {
                        jsonBodyCurrent = currentConfig
                    })
                    this.changeConfigValuesInMemory(this.getAllCurrentValuesInMemory())
                    let jsonBodyAll = this.json

                    let ledCount = this.getLedCount()

                    let finalJson = this.addLedCountToObjects(jsonBodyCurrent, wholeConfig, ledCount)
                    console.log(finalJson)
                    updateConfig(finalJson)
                })

                clearTimeout(timeout)
                resolve()
            } catch(e){
                if(!timeoutReached){
                    clearTimeout(timeout)
                    reject(e)
                }
            }
        })
    }

    async setConfigValuesInTextFields(){
        return new Promise((resolve, reject) => {
            let timeoutReached = false

            const timeout = setTimeout(() => {
                timeoutReached = true
                console.log("Loading the config took too long. Which is unusual.")
                resolve()
            })

            try{
                configValues.forEach(textfield => {
                    textfield.value = this.json[textfield.name]
                });
                sliders.forEach((element) => {
                    element.dispatchEvent(new Event("input", sliderToText))
                })
                sliderTextFields.forEach((element) => {
                    element.dispatchEvent(new Event("input", textToSlider))
                })
                clearTimeout(timeout)
                resolve()
            } catch(e){
                if(!timeoutReached){
                    clearTimeout(timeout)
                    reject(e)
                }
            }
        })
    }

    getAllCurrentValuesInMemory(){
        let jsonBody = {}
        configValues.forEach((element) => {
            jsonBody[element.name] = parseFloat(element.value)
        })

        return jsonBody
    }

    getOnlyCurrentChangedValues(){
        return new Promise((resolve, reject) => {
            try {
                let jsonBody = {}
                configValues.forEach((element) => {
                    if(this.json[element.name].toString() != element.value.toString()){
                        jsonBody[element.name] = parseFloat(element.value)
                    }
                })
        
                resolve(jsonBody)
            } catch(e){
                reject(e)
            }
        })
    }
}









//////////////////////// Variables /////////////////////////////////////////////////////////////////
const sliders = document.querySelectorAll(".slider")
const sliderTextFields = document.querySelectorAll(".sliderTextField")
const configValues = document.querySelectorAll(".configValue")
const config = new ConfigValues()

const loadingPage = document.getElementById("loadingPage")
const ambilightPage = document.getElementById("ambilightPage")
const changeStartLedPage = document.getElementById("changeStartLedPage")

const changeStartLedButton = document.getElementById("changeStartLedButton")
const changeConfigButton = document.getElementById("changeConfigButton")
const resetConfigChangesButton = document.getElementById("resetConfigChangesButton")










//////////////////////// Fetch Functions ///////////////////////////////////////////////////////////
async function loadProgramConfig(){
    return new Promise((resolve, reject) => {
        let timeoutReached = false;

        // Set a timeout to trigger after 3 seconds
        const timeout = setTimeout(() => {
            timeoutReached = true; // Mark timeout flag as true
            console.log("Loading the config took too long, which is unusual.");
            resolve(); // Resolve the promise even after timeout
        }, 3000);

        fetch("/get-config", {
            headers:{"Referer": config.json["name"] != null ? config.json["name"].toLowerCase : "undefined" + ".js"}
        })
            .then(response => {
                if(response.status != 200){
                    throw new Error(response.json())
                }
                return response.json()
            })
            .then(newConfig => {
                console.log(newConfig.Ambilight)
                config.setConfigValuesInMemory(newConfig.Ambilight)
                console.log("Succesfully loaded " + config.json["name"] + " Config!")
                console.log(config.json)
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

async function returnWholeConfig(){
    return new Promise((resolve, reject) => {
        let timeoutReached = false;

        // Set a timeout to trigger after 3 seconds
        const timeout = setTimeout(() => {
            timeoutReached = true; // Mark timeout flag as true
            console.log("Loading the config took too long, which is unusual.");
            resolve(); // Resolve the promise even after timeout
        }, 3000);

        fetch("/get-config", {
            headers:{"Referer": config.json["name"] != null ? config.json["name"].toLowerCase : "undefined" + ".js"}
        })
            .then(response => {
                if(response.status != 200){
                    throw new Error(response.json())
                }
                return response.json()
            })
            .then(newConfig => {
                console.log("Succesfully loaded Whole Config!")
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

async function updateConfig(jsonBody){
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
                "Referer": config.json["name"] != null ? config.json["name"].toLowerCase : "undefined" + ".js"
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
                console.log("Success: " + data.message)
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










//////////////////////// Helper Functions ///////////////////////////////////////////////////////////
function showLoadingPage(){
    loadingPage.style.display = "block"
    ambilightPage.style.display = "none"
    changeStartLedPage.style.display = "none"
}

function showAmbilightPage(){
    loadingPage.style.display = "none"
    ambilightPage.style.display = "grid"
    changeStartLedPage.style.display = "none"
}

function showChangeStartLedPage(){
    loadingPage.style.display = "none"
    ambilightPage.style.display = "none"
    changeStartLedPage.style.display = "grid"
}











//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    showLoadingPage()
    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()

    showAmbilightPage()
}

const textToSlider = (element) => {
    let textField = element.srcElement
    let parentDiv = textField.parentElement.parentElement
    
    let slider = parentDiv.children[1]
    
    slider.value = textField.value;
}

const sliderToText = (element) => {
    let slider = element.srcElement
    let parentDiv = slider.parentElement

    let textField = parentDiv.children[2].children[0]

    textField.value = slider.value;
}
sliders.forEach((element) => {
    element.addEventListener("input", sliderToText)
})

sliderTextFields.forEach((element) => {
    element.addEventListener("input", textToSlider)
});

function addStartLedButtons(){
    for(let i = 0; i < config.getLedCount(); i++){
        let button = new button()
    }
}

changeStartLedButton.addEventListener(("click"), async () => {
    showChangeStartLedPage()
})

changeConfigButton.addEventListener("click", async () => {
    await config.setConfigValuesInJson()
})

resetConfigChangesButton.addEventListener("click", async () => {
    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()
})