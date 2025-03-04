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

    async loadConfigInMemory(){
        await loadConfig()
    }

    setConfigValuesInMemory(count_left, count_top, count_right, count_bottom, offset, brightness, strength_red, strength_green, strength_blue, strength_black, smoothness){
        this.json = {
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

    setConfigValuesInJson(){
        let jsonBodyCurrent = this.getOnlyCurrentChangedValues
        let jsonBodyAll = this.getAllCurrentValues()

        this.setConfigValuesInMemory(jsonBodyAll)
        updateConfig(jsonBodyCurrent);

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
                for(let key in this.json){
                    let textfield = document.getElementsByName(key)[0]
                    textfield.value = this.json[key]
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

    getAllCurrentValues(){
        let jsonBody = {}
        configValues.forEach((element) => {
            jsonBody[element.name] = element.value
        })

        return jsonBody
    }

    getOnlyCurrentChangedValues(){
        let jsonBody = {}
        configValues.forEach((element) => {
            if(this.json[element.name] != element.value){
                jsonBody[element.name] = element.value
            }
        })

        return jsonBody
    }
}









//////////////////////// Variables /////////////////////////////////////////////////////////////////
let sliders = document.querySelectorAll(".slider")
let sliderTextFields = document.querySelectorAll(".sliderTextField")
let configValues = document.querySelectorAll(".configValue")
let config = new ConfigValues()

let loadingPage = document.getElementById("loadingPage")
let ambilightPage = document.getElementById("ambilightPage")










//////////////////////// Fetch Functions ///////////////////////////////////////////////////////////
async function loadConfig(){
    return new Promise((resolve, reject) => {
        let timeoutReached = false;

        // Set a timeout to trigger after 3 seconds
        const timeout = setTimeout(() => {
            timeoutReached = true; // Mark timeout flag as true
            console.log("Loading the config took too long, which is unusual.");
            resolve(); // Resolve the promise even after timeout
        }, 3000);

        fetch("/get-config")
            .then(response => {
                if(response.status != 200){
                    throw new Error(response.json())
                }
                return response.json()
            })
            .then(newConfig => {
                config.setConfigValuesInMemory(newConfig.Ambilight)
                console.log("Succesfully loaded Ambilight Config!")
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
                "Content-Type": "application/json"
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
function showLoading(){
    loadingPage.style.display = "block"
    ambilightPage.style.display = "none"
}

function showPage(){
    loadingPage.style.display = "none"
    ambilightPage.style.display = "grid"
}











//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    showLoading()
    await config.loadConfigInMemory()
    await config.setConfigValuesInTextFields()

    sliders.forEach((element) => {
        element.dispatchEvent(new Event("input", sliderToText))
    })
    sliderTextFields.forEach((element) => {
        element.dispatchEvent(new Event("input", textToSlider))
    })

    showPage()
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

