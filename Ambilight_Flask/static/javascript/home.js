let loadingPage = document.getElementById("loadingPage")
let startPage = document.getElementById("startPage")
let contentPage = document.getElementById("contentPage")

let changeModeButton = document.getElementById("changeModeButton")
let modeSelection = document.getElementById("modeSelection")
let powerSwitch = document.getElementById("powerSwitch")

let mode, power


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
        
        fetch(page)
            .then(response => response.text())
            .then(html => {
                contentPage.innerHTML = html
                clearTimeout(timeout)
                resolve()
            })
            .catch(error => {
                console.log("Error while loading: " + error)
                if(!timeoutReached){
                    clearTimeout(timeout)
                    reject(error)
                }
            })
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
            .then(response => response.json())
            .then(config => {
                mode = config.mode
                power = config.power
                console.log("Succesfully loaded Config!")
                clearTimeout(timeout)
                resolve()
            })
            .catch(error => {
                console.log("Error while loading: " + error)
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

async function loadScript(){
    let jsonBody

    if(powerSwitch.checked){
        jsonBody = {
            "power": "on"
        }
    } else{
        jsonBody = {
            "power": "off"
        }
    }

    await updateConfig(jsonBody)
    await loadConfig()

    updatePython(mode, jsonBody)
}

//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    showLoading()

    await loadConfig()

    showPage()

    modeSelection.value = mode
    powerSwitch.checked = power == "on" ? true : false

    loadPage("/" + mode)
}

changeModeButton.addEventListener("click", async () => {
    modeSelection.style.color = "black"

    let selectedMode = modeSelection.value

    let jsonBody = {
        "mode": selectedMode
    }

    await updateConfig(jsonBody)
    await loadConfig()

    await loadScript()

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
    await loadScript()
})