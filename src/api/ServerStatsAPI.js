const ServerStats = require("../ServerStats");
const express = require("express");
const cors = require("cors");
const fs = require("fs");

class ServerStatsAPI {
    constructor(bot, startServer = true) {
        this.app = express();
        this.port = 8181;
        this.bot = bot
        this.started = false;
        this.historyFileName = "config/ServerStatsHistory.log"

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
            origin: [
                "https://emailbot.larskaesberg.de",
                "https://EmailBot.srtf.dev",
                "http://localhost:8000"
            ]
        }));

        this.app.get('/mailsSendAll', (req, res) => {
            res.send(this.serverStats.mailsSendAll.toString())
        });

        this.app.get('/mailsSendToday', async (req, res) => {
            await this.serverStats.testDate()
            res.send(this.serverStats.mailsSendToday.toString())
        });

        this.app.get('/usersVerifiedAll', (req, res) => {
            res.send(this.serverStats.usersVerifiedAll.toString())
        });

        this.app.get('/usersVerifiedToday', async (req, res) => {
            await this.serverStats.testDate()
            res.send(this.serverStats.usersVerifiedToday.toString())
        });

        this.app.get('/serverCount', async (req, res) => {
            const count = await this.getServerCount();
            res.send(count.toString());
        });

        // Get current stats as JSON (for the stats page)
        this.app.get('/stats/current', async (req, res) => {
            await this.serverStats.testDate()
            const serverCount = await this.getServerCount()
            res.json({
                date: new Date().toISOString().split('T')[0],
                mailsSendToday: this.serverStats.mailsSendToday,
                mailsSendAll: this.serverStats.mailsSendAll,
                usersVerifiedToday: this.serverStats.usersVerifiedToday,
                usersVerifiedAll: this.serverStats.usersVerifiedAll,
                serverCount: serverCount
            })
        });

        // Get historical stats from log file
        this.app.get('/stats/history', async (req, res) => {
            const days = parseInt(req.query.days) || 30
            try {
                const history = this.parseHistoryFile(days)
                res.json(history)
            } catch (err) {
                res.status(500).json({ error: 'Failed to read history' })
            }
        });
    }

    parseHistoryFile(days) {
        if (!fs.existsSync(this.historyFileName)) {
            return []
        }
        
        // Read only the last N lines efficiently from the end of file
        const lines = this.readLastLines(days)
        
        const results = []
        for (const line of lines) {
            const parts = line.split(',')
            if (parts.length >= 4) {
                // Handle both old format (4 cols) and new format (6 cols)
                const entry = {
                    date: parts[0],
                    mailsSendToday: parseInt(parts[1]) || 0,
                    mailsSendAll: parseInt(parts[2]) || 0,
                    usersVerifiedToday: parts.length >= 5 ? parseInt(parts[3]) || 0 : 0,
                    usersVerifiedAll: parts.length >= 5 ? parseInt(parts[4]) || 0 : 0,
                    serverCount: parseInt(parts[parts.length - 1]) || 0
                }
                results.push(entry)
            }
        }
        
        return results
    }

    readLastLines(numLines) {
        const stat = fs.statSync(this.historyFileName)
        const fileSize = stat.size
        
        if (fileSize === 0) return []
        
        // Estimate ~100 bytes per line, read a bit more to be safe
        const chunkSize = Math.min(fileSize, numLines * 150)
        const buffer = Buffer.alloc(chunkSize)
        
        const fd = fs.openSync(this.historyFileName, 'r')
        try {
            // Read from end of file
            const startPos = Math.max(0, fileSize - chunkSize)
            fs.readSync(fd, buffer, 0, chunkSize, startPos)
            
            let data = buffer.toString('utf8')
            
            // If we didn't read from start, we might have a partial first line - remove it
            if (startPos > 0) {
                const firstNewline = data.indexOf('\n')
                if (firstNewline !== -1) {
                    data = data.substring(firstNewline + 1)
                }
            }
            
            const lines = data.trim().split('\n').filter(line => line.length > 0)
            
            // Return only the last N lines
            return lines.slice(-numLines)
        } finally {
            fs.closeSync(fd)
        }
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
                    console.log(`[Shard ${shardUtil.ids}] Forwarding mail count to shard 0`)
                    shardUtil.broadcastEval(async (client) => {
                        if (client.shard && client.shard.ids.includes(0) && client.serverStatsAPI) {
                            console.log(`[Shard ${client.shard.ids}] Received mail count from another shard`)
                            await client.serverStatsAPI.serverStats.increaseMailSend();
                        }
                    }).catch(() => {});
                    return;
                }
            }
        } catch {}
        // Unsharded or primary shard: update locally
        console.log(`[Shard ${this.bot.shard?.ids ?? 'N/A'}] Increasing mail send locally`)
        await this.serverStats.increaseMailSend()
    }

    async increaseVerifiedUsers() {
        try {
            const shardUtil = this.bot.shard;
            if (shardUtil && typeof shardUtil.count === 'number' && shardUtil.count > 1) {
                // If this is NOT the primary shard (id 0), forward the increment to shard 0
                if (!shardUtil.ids.includes(0)) {
                    console.log(`[Shard ${shardUtil.ids}] Forwarding verified user count to shard 0`)
                    shardUtil.broadcastEval(async (client) => {
                        if (client.shard && client.shard.ids.includes(0) && client.serverStatsAPI) {
                            console.log(`[Shard ${client.shard.ids}] Received verified user count from another shard`)
                            await client.serverStatsAPI.serverStats.increaseVerifiedUsers();
                        }
                    }).catch(() => {});
                    return;
                }
            }
        } catch {}
        // Unsharded or primary shard: update locally
        console.log(`[Shard ${this.bot.shard?.ids ?? 'N/A'}] Increasing verified users locally`)
        await this.serverStats.increaseVerifiedUsers()
    }

}

module.exports = ServerStatsAPI


