const ServerStats = require("../ServerStats");
const express = require("express");
const cors = require("cors");

class ServerStatsAPI {
    constructor(bot, startServer = true) {
        this.serverStats = new ServerStats()
        this.app = express();
        this.port = 8181;
        this.bot = bot

        this.registerEndpoints(startServer)

    }

    registerEndpoints(startServer) {
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
            try {
                const shardUtil = this.bot.shard;
                if (shardUtil && typeof shardUtil.count === 'number' && shardUtil.count > 1) {
                    const counts = await shardUtil.fetchClientValues('guilds.cache.size');
                    const total = counts.reduce((sum, count) => sum + Number(count || 0), 0);
                    res.send(total.toString());
                    return;
                }
            } catch {}
            const servers = this.bot.guilds.cache;
            res.send(servers.size.toString())
        });

        if (startServer) {
            this.app.listen(this.port, () => {
                console.log(`App listening on port ${this.port}!`)
            });
        }
    }

    increaseMailSend() {
        this.serverStats.increaseMailSend()
    }

}

module.exports = ServerStatsAPI


