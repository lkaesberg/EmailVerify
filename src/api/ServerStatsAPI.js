const ServerStats = require("../ServerStats");
const express = require("express");
const cors = require("cors");

class ServerStatsAPI {
    constructor(bot) {
        this.serverStats = new ServerStats()
        this.app = express();
        this.port = 8181;
        this.bot = bot

        this.registerEndpoints()

    }

    registerEndpoints() {
        this.app.use(cors({
            origin: "https://emailbot.larskaesberg.de"
        }));

        this.app.get('/mailsSendAll', (req, res) => {
            res.send(this.serverStats.mailsSendAll.toString())
        });

        this.app.get('/mailsSendToday', (req, res) => {
            this.serverStats.testDate()
            res.send(this.serverStats.mailsSendToday.toString())
        });

        this.app.get('/serverCount', async (req, res) => {
            let servers = await this.bot.guilds.cache
            res.send(servers.size.toString())
        });

        this.app.listen(this.port, () => {
            console.log(`App listening on port ${this.port}!`)
        });
    }

    increaseMailSend() {
        this.serverStats.increaseMailSend()
    }

}

module.exports = ServerStatsAPI


