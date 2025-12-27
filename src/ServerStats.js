'use strict';
const fs = require("fs");
module.exports = class ServerStats {
    constructor(getServerCountFn = null) {
        this.mailsSendAll = 0
        this.mailsSendToday = 0
        this.usersVerifiedAll = 0
        this.usersVerifiedToday = 0
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
            this.usersVerifiedAll = serverStats.usersVerifiedAll || 0
            this.usersVerifiedToday = serverStats.usersVerifiedToday || 0
            if (serverStats.lastDate) {
                this.lastDate = new Date(serverStats.lastDate)
            }
        } catch {
            this.updateFile()
        }
    }

    async increaseMailSend() {
        await this.testDate()
        this.mailsSendAll += 1
        this.mailsSendToday += 1
        this.updateFile()
    }

    async increaseVerifiedUsers() {
        await this.testDate()
        this.usersVerifiedAll += 1
        this.usersVerifiedToday += 1
        this.updateFile()
    }

    async testDate() {
        const date = new Date();
        if (date.getUTCDate() !== this.lastDate.getUTCDate()) {
            // Save yesterday's stats to history before resetting
            await this.appendDailyStats()
            this.lastDate = date
            this.mailsSendToday = 0
            this.usersVerifiedToday = 0
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
        const logLine = `${dateStr},${this.mailsSendToday},${this.mailsSendAll},${this.usersVerifiedToday},${this.usersVerifiedAll},${serverCount}\n`
        fs.appendFileSync(this.historyFileName, logLine)
        console.log(`Saved daily stats: ${logLine.trim()}`)
    }

    updateFile() {
        fs.writeFileSync(this.fileName, JSON.stringify({
            mailsSendAll: this.mailsSendAll,
            mailsSendToday: this.mailsSendToday,
            usersVerifiedAll: this.usersVerifiedAll,
            usersVerifiedToday: this.usersVerifiedToday,
            lastDate: this.lastDate.toISOString()
        }))
    }
}