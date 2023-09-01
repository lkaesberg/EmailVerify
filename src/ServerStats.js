'use strict';
const fs = require("fs");
module.exports = class ServerStats {
    constructor() {
        this.mailsSendAll = 0
        this.mailsSendToday = 0
        this.lastDate = new Date()
        this.fileName = "config/ServerStats.json"
        if (!fs.existsSync(this.fileName)) {
            this.updateFile()
        }
        const data = fs.readFileSync(this.fileName, {encoding: 'utf8', flag: 'r'});

        try {
            let serverStats = JSON.parse(data);
            this.mailsSendAll = serverStats.mailsSendAll
            this.mailsSendToday = serverStats.mailsSendToday
        } catch {
            this.updateFile()
        }
    }

    increaseMailSend() {
        this.testDate()
        this.mailsSendAll += 1
        this.mailsSendToday += 1
        this.updateFile()
    }

    testDate() {
        const date = new Date();
        if (date.getUTCDate() !== this.lastDate.getUTCDate()) {
            this.lastDate = date
            this.mailsSendToday = 0
            console.log("RESET")
            this.updateFile()
        }
    }

    updateFile() {
        fs.writeFileSync(this.fileName, JSON.stringify({
            mailsSendAll: this.mailsSendAll,
            mailsSendToday: this.mailsSendToday
        }))
    }
}