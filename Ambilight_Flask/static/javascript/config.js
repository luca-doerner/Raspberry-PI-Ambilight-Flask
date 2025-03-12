export class Config{
    constructor(controller){
        this.controller = controller
        this.json = {
            "count_left": 0,
            "count_top": 0,
            "count_right": 0,
            "count_bottom": 0,
            "offset": 0,
            "brightness": 0,
            "strength_red": 0,
            "strength_green": 0,
            "strength_blue": 0,
            "strength_black": 0,
            "smoothness": 0
        }
    }

    async loadProgramConfigInMemory(){
        await this.controller.loadProgramConfig()
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
            Object.keys(currentJson).forEach((key) => {
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
                this.controller.returnWholeConfig().then(async wholeConfig => {
                    let jsonBodyCurrent
                    await this.getOnlyCurrentChangedValues().then(currentConfig => {
                        jsonBodyCurrent = currentConfig
                    })
                    this.changeConfigValuesInMemory(this.getAllCurrentValuesInMemory())

                    let ledCount = this.getLedCount()

                    let finalJson = this.addLedCountToObjects(jsonBodyCurrent, wholeConfig, ledCount)
                    this.controller.updateConfig(finalJson)
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

    async setConfigValuesInTextFields(configValues, sliders, sliderTextFields){
        return new Promise((resolve, reject) => {
            let timeoutReached = false

            const timeout = setTimeout(() => {
                timeoutReached = true
                console.log("Loading the config took too long. Which is unusual.")
                resolve()
            })

            try{
                this.controller.configValues.forEach(textfield => {
                    textfield.value = this.json[textfield.name]
                })
                if(this.sliders != null){
                    this.controller.sliders.forEach((element) => {
                        element.dispatchEvent(new Event("input", this.controller.sliderToText))
                    })
                }
                if(this.sliderTextFields != null){
                    this.controller.sliderTextFields.forEach((element) => {
                        element.dispatchEvent(new Event("input", this.controller.textToSlider))
                    })
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

    getAllCurrentValuesInMemory(){
        let jsonBody = {}
        this.controller.configValues.forEach((element) => {
            jsonBody[element.name] = parseFloat(element.value)
        })

        return jsonBody
    }

    getOnlyCurrentChangedValues(){
        return new Promise((resolve, reject) => {
            try {
                let jsonBody = {}
                this.controller.configValues.forEach((element) => {
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