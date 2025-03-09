import { Controller } from "./controller.js"

//////////////////////// Variables /////////////////////////////////////////////////////////////////
const sliders = document.querySelectorAll(".slider")
const sliderTextFields = document.querySelectorAll(".sliderTextField")
const configValues = document.querySelectorAll(".configValue")

const loadingPage = document.getElementById("loadingPage")
const contentPage = document.getElementById("contentPage")
const changeStartLedPage = document.getElementById("changeStartLedPage")

const changeStartLedButton = document.getElementById("changeStartLedButton")
const changeConfigButton = document.getElementById("changeConfigButton")
const resetConfigChangesButton = document.getElementById("resetConfigChangesButton")

const controller = new Controller("Ambilight", [loadingPage, contentPage, changeStartLedPage], configValues, sliders, sliderTextFields)
const config = controller.config








//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    controller.showPage(loadingPage)
    
    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()

    changeStartLedButton.value = changeStartLedButton.value

    controller.showPage(contentPage)
}

sliders.forEach((element) => {
    element.addEventListener("input", controller.sliderToText)
})

sliderTextFields.forEach((element) => {
    element.addEventListener("input", controller.textToSlider)
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
    controller.showPage(loadingPage)
    config.newOffset = changeStartLedButton.value
    await addStartLedButtons()
    synchronizeStartLedInput()
    controller.showPage(changeStartLedPage)
})

changeConfigButton.addEventListener("click", async () => {
    await config.setConfigValuesInJson()
})

resetConfigChangesButton.addEventListener("click", async () => {
    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()
})

document.querySelectorAll(".actionStartLedPageButton").forEach((element) => {
    element.addEventListener("click", actionStartLedPage)
})

function actionStartLedPage(element){
    element = element.srcElement

    if(element.textContent === "OK"){
        controller.showPage(loadingPage)
        changeStartLedButton.value = config.newOffset
        controller.showPage(contentPage)
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
        controller.showPage(loadingPage)
        controller.showPage(contentPage)
    }
}