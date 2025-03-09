import { Controller } from "./controller.js"

//////////////////////// Variables /////////////////////////////////////////////////////////////////
MODE = ""

const sliders = document.querySelectorAll(".slider")
const sliderTextFields = document.querySelectorAll(".sliderTextField")
const configValues = document.querySelectorAll(".configValue")

const loadingPage = document.getElementById("loadingPage")
const contentPage = document.getElementById("contentPage")

const changeConfigButton = document.getElementById("changeConfigButton")
const resetConfigChangesButton = document.getElementById("resetConfigChangesButton")

const controller = new Controller(MODE, [loadingPage, contentPage, changeStartLedPage], configValues, sliders, sliderTextFields)
const config = controller.config








//////////////////////// Document Functions /////////////////////////////////////////////////////////
window.onload = async () => {
    controller.showPage(loadingPage)

    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()

    controller.showPage(contentPage)
}

sliders.forEach((element) => {
    element.addEventListener("input", controller.sliderToText)
})

sliderTextFields.forEach((element) => {
    element.addEventListener("input", controller.textToSlider)
})

changeConfigButton.addEventListener("click", async () => {
    await config.setConfigValuesInJson()
})

resetConfigChangesButton.addEventListener("click", async () => {
    await config.loadProgramConfigInMemory()
    await config.setConfigValuesInTextFields()
})