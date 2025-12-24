'use strict';
const fs = require("fs");
module.exports = class ServerStats {
    constructor(getServerCountFn = null) {
        this.mailsSendAll = 0
        this.mailsSendToday = 0
        this.lastDate = new Date()
        this.fileName = "config/ServerStats.json"
        this.historyFileName = "config/ServerStatsHistory.log"
        this.getServerCount = getServerCountFn
        if (!fs.existsSync(this.fileName)) {
            this.updateFile()
        }
        const data = fs.readFileSync(this.fileName, {encoding: 'utf8', flag: 'r'});

        try {
            let serverStats = JSON.parse(data);
            this.mailsSendAll = serverStats.mailsSendAll
            this.mailsSendToday = serverStats.mailsSendToday
            if (serverStats.lastDate) {
                this.lastDate = new Date(serverStats.lastDate)
            }
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
            // Save yesterday's stats to history before resetting
            this.appendDailyStats()
            this.lastDate = date
            this.mailsSendToday = 0
            console.log("RESET")
            this.updateFile()
        }
    }

    async appendDailyStats() {
        const dateStr = this.lastDate.toISOString().split('T')[0]
        let serverCount = 0
        if (this.getServerCount) {
            try {
                serverCount = await this.getServerCount()
            } catch {}
        }
        const logLine = `${dateStr},${this.mailsSendToday},${this.mailsSendAll},${serverCount}\n`
        fs.appendFileSync(this.historyFileName, logLine)
        console.log(`Saved daily stats: ${logLine.trim()}`)
    }

    updateFile() {
        fs.writeFileSync(this.fileName, JSON.stringify({
            mailsSendAll: this.mailsSendAll,
            mailsSendToday: this.mailsSendToday,
            lastDate: this.lastDate.toISOString()
        }))
    }
}