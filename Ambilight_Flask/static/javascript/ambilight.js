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

        Object.keys(this.json).forEach((key) => {
            if(key.startsWith("count_")){
                summedLedCount += this.json[key]
            }
        })

        if(summedLedCount == 0){
            ledCount = this.json["led_count"]
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

                    let ledCount = this.getLedCount()

                    let finalJson = this.addLedCountToObjects(jsonBodyCurrent, wholeConfig, ledCount)
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
                config.setConfigValuesInMemory(newConfig.Ambilight)
                console.log({"message": "Succesfully loaded " + config.json["name"] + " Config!", "data": config.json})
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

    changeStartLedButton.value = changeStartLedButton.value

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

async function addStartLedButtons(){
    return new Promise((resolve, reject) => {
        let timeoutReached = false;

        // Set a timeout to trigger after 3 seconds
        const timeout = setTimeout(() => {
            timeoutReached = true; // Mark timeout flag as true
            console.log("Loading the config took too long, which is unusual.");
            resolve(); // Resolve the promise even after timeout
        }, 3000);

        try{
            let changeStartLedLeftContainer = document.getElementById("changeStartLedLeftContainer")
            let changeStartLedTopContainer = document.getElementById("changeStartLedTopContainer")
            let changeStartLedRightContainer = document.getElementById("changeStartLedRightContainer")
            let changeStartLedBottomContainer = document.getElementById("changeStartLedBottomContainer")
            changeStartLedLeftContainer.replaceChildren()
            changeStartLedTopContainer.replaceChildren()
            changeStartLedRightContainer.replaceChildren()
            changeStartLedBottomContainer.replaceChildren()

            for(let i = 0; i < config.getLedCount(); i++){
                let ledElement = document.createElement("div")
                ledElement.classList.add("changeStartLedButtons")
                ledElement.addEventListener("click", updateStartLed)

                if(i < config.json["count_left"]){
                    ledElement.setAttribute("name", config.json["count_left"]-i-1)
                    changeStartLedLeftContainer.appendChild(ledElement)
                } else if(i < config.json["count_left"] + config.json["count_top"]){
                    ledElement.setAttribute("name", i)
                    changeStartLedTopContainer.appendChild(ledElement)
                } else if(i < config.json["count_left"] + config.json["count_top"] + config.json["count_right"]){
                    ledElement.setAttribute("name", i)
                    changeStartLedRightContainer.appendChild(ledElement)
                } else {
                    ledElement.setAttribute("name", (config.getLedCount()+(config.json["count_left"] + config.json["count_top"] + config.json["count_right"]))-i-1)
                    changeStartLedBottomContainer.appendChild(ledElement)
                }
                if(ledElement.getAttribute("name") == changeStartLedButton.value){
                    ledElement.style.background = "green"
                }
            }

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

function synchronizeStartLedInput(){
    let changeStartLedInput = document.getElementById("changeStartLedInput")

    changeStartLedInput.setAttribute("max", config.getLedCount().toString())

    changeStartLedInput.value = parseInt(config.newOffset)+1
    changeStartLedInput.setAttribute("name", changeStartLedInput.value-1)

    changeStartLedInput.addEventListener("input", updateStartLed)
}

function updateStartLed(element){
    element = element.srcElement
    if(element.localName === "input"){
        element.setAttribute("name", (element.value-1) >= 0 ? (element.value-1) <= config.getLedCount()-1 ? element.value-1 : config.getLedCount()-1 : 0)
    }
    let oldStartLed = config.newOffset
    let newStartLed = element.getAttribute("name")
    document.getElementsByName(oldStartLed).forEach((ele) => {
        if(ele.localName === "input"){
            return
        }
        ele.style.background = "white"
    })
    document.getElementsByName(newStartLed).forEach((ele) => {
        if(ele.localName === "input"){
            return
        }
        ele.style.background = "green"
    })
    config.newOffset = parseInt(newStartLed)
    synchronizeStartLedInput()
}

changeStartLedButton.addEventListener(("click"), async () => {
    showLoadingPage()
    config.newOffset = changeStartLedButton.value
    await addStartLedButtons()
    synchronizeStartLedInput()
    showChangeStartLedPage()
})

changeConfigButton.addEventListener("click", async () => {
    await config.setConfigValuesInJson()
})

resetConfigChangesButton.addEventListener("click", async () => {
    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()
})

function actionStartLedPage(element){
    if(element.textContent === "OK"){
        showLoadingPage()
        changeStartLedButton.value = config.newOffset
        showAmbilightPage()
    } else if(element.textContent === "Anwenden"){
        changeStartLedButton.value = config.newOffset
    } else if(element.textContent === "Zurücksetzen"){
        let originalStartLed
        document.getElementsByName(changeStartLedButton.value).forEach((ele) => {
            if(ele.localName === "input"){
                return
            }
            originalStartLed = ele
        })
        originalStartLed.dispatchEvent(new Event("click"))
    } else if(element.textContent === "Abbrechen"){
        showLoadingPage()
        showAmbilightPage()
    }
}