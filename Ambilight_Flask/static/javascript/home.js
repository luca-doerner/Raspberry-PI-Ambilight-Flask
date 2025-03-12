import { Controller } from "./controller.js"

const loadingPage = document.getElementById("loadingPage")
const startPage = document.getElementById("startPage")
const contentPage = document.getElementById("contentPage")

const changeModeButton = document.getElementById("changeModeButton")
const modeSelection = document.getElementById("modeSelection")
const powerSwitch = document.getElementById("powerSwitch")
const configValues = document.querySelectorAll(".configValue")

const controller = new Controller("", [loadingPage, startPage], configValues)


//////////////////////// Fetch Functions ///////////////////////////////////////////////////////////
async function loadPage(page){
    return new Promise((resolve, reject) => {
        let timeoutReached = false;

        // Set a timeout to trigger after 3 seconds
        const timeout = setTimeout(() => {
            timeoutReached = true; // Mark timeout flag as true
            console.log("Loading the config took too long, which is unusual.");
            resolve(); // Resolve the promise even after timeout
        }, 3000);
        
        try{
            contentPage.src = "/" + mode
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
            .then(config => {
                mode = config.mode
                power = config.power
                console.log("Succesfully loaded Config!")
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

async function updatePython(type, jsonBody){
    fetch("/power/" + type, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(jsonBody)
    })
        .then(response => {
            if(response.status != 200){
                return response.json().then(errData => {
                    throw new Error(`Error: ${errData.error}, Details: ${errData.details}`)
                })
            }
            return response.json()
        })
        .then(data => console.log(data.message))
        .catch(error => console.log(error.message))
}



//////////////////////// Helper Functions ///////////////////////////////////////////////////////////
function showLoading(){
    loadingPage.style.display = "block"
    startPage.style.display = "none"
}

function showPage(){
    loadingPage.style.display = "none"
    startPage.style.display = "grid"
}

async function setPowerSwitch(newPower){
    if(newPower === "on"){
        powerSwitch.checked = true
        powerSwitch.value = "on"
    } else if(newPower === "off"){
        powerSwitch.checked = false
        powerSwitch.value = "off"
    }

}

async function startMode(){
    await config.updateConfig()

    updatePython(mode, jsonBody)
}

async function changeMode(){
    await config.updateConfig()

    
}

//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    controller.showPage(loadingPage)

    await config.loadProgramConfig()
    await config.setConfigValuesInTextFields()
    setPowerSwitch(config.json["power"])

    await loadPage("/" + config.json["mode"])

    controller.showPage(startPage)
}

changeModeButton.addEventListener("click", async () => {


    powerSwitch.checked = false

    setPowerSwitch(powerSwitch.checked === true ? "on" : "off")
    await updateConfig()

    loadPage("/" + selectedMode)
})

modeSelection.addEventListener("change", () => {
    if(mode != modeSelection.value){
        modeSelection.style.color = "red"
        for(i = 0; i < modeSelection.options.length; i++){
            modeSelection.options[i].style.color = "black"
        }
    } else {
        modeSelection.style.color = "black"
    }
})

powerSwitch.addEventListener("change", async () => {
    await setPowerSwitch(powerSwitch.checked === true ? "on" : "off")
    await startMode()
})