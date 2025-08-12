const ServerStats = require("../ServerStats");
const express = require("express");
const cors = require("cors");

class ServerStatsAPI {
    constructor(bot, startServer = true) {
        this.serverStats = new ServerStats()
        this.app = express();
        this.port = 8181;
        this.bot = bot
        this.started = false;

        this.registerEndpoints()
        if (startServer) this.start()

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
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.app.listen(this.port, () => {
            console.log(`App listening on port ${this.port}!`)
        });
    }

    increaseMailSend() {
        try {
            const shardUtil = this.bot.shard;
            if (shardUtil && typeof shardUtil.count === 'number' && shardUtil.count > 1) {
                // If this is NOT the primary shard (id 0), forward the increment to shard 0
                if (!shardUtil.ids.includes(0)) {
                    shardUtil.broadcastEval((client) => {
                        if (client.shard && client.shard.ids.includes(0) && client.serverStatsAPI) {
                            client.serverStatsAPI.serverStats.increaseMailSend();
                        }
                    }).catch(() => {});
                    return;
                }
            }
        } catch {}
        // Unsharded or primary shard: update locally
        this.serverStats.increaseMailSend()
    }

}

module.exports = ServerStatsAPI


