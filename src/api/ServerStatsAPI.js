const ServerStats = require("../ServerStats");
const express = require("express");
const cors = require("cors");

class ServerStatsAPI {
    constructor(bot, startServer = true) {
        this.app = express();
        this.port = 8181;
        this.bot = bot
        this.started = false;

        this.serverStats = new ServerStats(() => this.getServerCount())

        this.registerEndpoints()
        if (startServer) this.start()

    }

    async getServerCount() {
        try {
            const shardUtil = this.bot.shard;
            if (shardUtil && typeof shardUtil.count === 'number' && shardUtil.count > 1) {
                const counts = await shardUtil.fetchClientValues('guilds.cache.size');
                return counts.reduce((sum, count) => sum + Number(count || 0), 0);
            }
        } catch {}
        return this.bot.guilds.cache.size;
    }

    registerEndpoints() {
        this.app.use(cors({
            origin: "https://emailbot.larskaesberg.de"
        }));

        this.app.get('/mailsSendAll', (req, res) => {
            res.send(this.serverStats.mailsSendAll.toString())
        });

        this.app.get('/mailsSendToday', async (req, res) => {
            await this.serverStats.testDate()
            res.send(this.serverStats.mailsSendToday.toString())
        });

        this.app.get('/serverCount', async (req, res) => {
            const count = await this.getServerCount();
            res.send(count.toString());
        });
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.app.listen(this.port, () => {
            console.log(`App listening on port ${this.port}!`)
        });
    }

    async increaseMailSend() {
        try {
            const shardUtil = this.bot.shard;
            if (shardUtil && typeof shardUtil.count === 'number' && shardUtil.count > 1) {
                // If this is NOT the primary shard (id 0), forward the increment to shard 0
                if (!shardUtil.ids.includes(0)) {
                    shardUtil.broadcastEval(async (client) => {
                        if (client.shard && client.shard.ids.includes(0) && client.serverStatsAPI) {
                            console.log("increasing mail send on shard " + client.shard.ids)
                            await client.serverStatsAPI.serverStats.increaseMailSend();
                        }
                    }).catch(() => {});
                    return;
                }
            }
        } catch {}
        // Unsharded or primary shard: update locally
        console.log("increasing mail send on shard " + this.bot.shard.ids)
        await this.serverStats.increaseMailSend()
    }

}

module.exports = ServerStatsAPI


