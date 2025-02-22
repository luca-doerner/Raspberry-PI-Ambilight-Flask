let loadingPage = document.getElementById("loadingPage")
let startPage = document.getElementById("startPage")

let changeModeButton = document.getElementById("changeModeButton")
let modeSelection = document.getElementById("modeSelection")
let powerSwitch = document.getElementById("powerSwitch")

let mode, power


//////////////////////// Fetch Functions ///////////////////////////////////////////////////////////
function loadPage(page){
    fetch(page)
        .then(response => response.text())
        .then(html => document.getElementById("contentPage").innerHTML = html)
        .catch(error => console.log("Error while loading: " + error))
}

function loadConfig(){
    return new Promise((resolve, reject) => {
        fetch("/get-config")
            .then(response => response.json())
            .then(config => {
                mode = config.mode
                power = config.power
            })
            .catch(error => console.log("Error while loading: " + error))
        setTimeout(() => {
            console.log("Config Loaded");
            resolve()
        }, 2000)
    })
}

function updateConfig(jsonBody){
    fetch("/set-config", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(jsonBody)
    })
        .then(response => response.json())
        .then(data => console.log("Success: " + data))
        .catch(error => console.log("Error while updating config: " + error))
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

//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    showLoading()

    await loadConfig()

    showPage()

    modeSelection.value = mode
    powerSwitch.checked = power == "on" ? true : false

    loadPage("/" + mode)
}

changeModeButton.addEventListener("click", () => {
    modeSelection.style.color = "black"

    let selectedMode = modeSelection.value

    let jsonBody = {
        "mode": selectedMode
    }

    updateConfig(jsonBody)

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

powerSwitch.addEventListener("change", () => {
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

    updateConfig(jsonBody)
})