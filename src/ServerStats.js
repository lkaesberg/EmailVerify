// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

'use strict';
const fs = require("fs");

/** YYYY-MM-DD in UTC. */
function utcDay(date) {
    return date.toISOString().split('T')[0]
}

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

    /**
     * Roll the "today" counters over when the UTC day changed. The comparison is on the
     * full date (comparing the day of the month alone missed a restart a month later,
     * e.g. Jan 5 -> Feb 5). The snapshot, reset and new lastDate all happen before the
     * first await, so a concurrent increment or stats GET sees the new day at once: it
     * neither appends a second history line nor gets its count zeroed by a late reset.
     */
    async testDate() {
        const date = new Date();
        if (utcDay(date) === utcDay(this.lastDate)) return
        const finished = {
            dateStr: utcDay(this.lastDate),
            mailsSendToday: this.mailsSendToday,
            mailsSendAll: this.mailsSendAll,
            usersVerifiedToday: this.usersVerifiedToday,
            usersVerifiedAll: this.usersVerifiedAll
        }
        this.lastDate = date
        this.mailsSendToday = 0
        this.usersVerifiedToday = 0
        console.log("RESET")
        this.updateFile()
        // Save the finished day's stats to history
        await this.appendDailyStats(finished)
    }

    async appendDailyStats(day) {
        let serverCount = 0
        if (this.getServerCount) {
            try {
                serverCount = await this.getServerCount()
            } catch {}
        }
        const logLine = `${day.dateStr},${day.mailsSendToday},${day.mailsSendAll},${day.usersVerifiedToday},${day.usersVerifiedAll},${serverCount}\n`
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