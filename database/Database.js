const ServerSettings = require('../ServerSettings.js')
const sqlite3 = require('sqlite3').verbose()

class Database {
    constructor() {
        this.db = new sqlite3.Database('bot.db');
        this.db.run("CREATE TABLE IF NOT EXISTS guilds(guildid INT PRIMARY KEY,domains TEXT,verifiedrole TEXT,unverifiedrole Text, channelid TEXT, messageid TEXT);")
        this.name = "LARS"
    }



    updateServerSettings(guildID, serverSettings) {
        this.db.run(
            "INSERT OR REPLACE INTO guilds (guildid, domains, verifiedrole, unverifiedrole, channelid, messageid) VALUES (?, ?, ?, ?, ?, ?)",
            [guildID, serverSettings.domains.toString(), serverSettings.verifiedRoleName, serverSettings.unverifiedRoleName, serverSettings.channelID, serverSettings.messageID])
    }

     async getServerSettings(guildID, callback) {
         const serverSettings = new ServerSettings()
         await this.db.get("SELECT * FROM guilds WHERE guildid = ?", [guildID], async (err, result) => {
                 if (err) {
                     throw err;
                 }
                 if (result !== undefined) {
                     serverSettings.channelID = result.channelid
                     serverSettings.messageID = result.messageid
                     serverSettings.verifiedRoleName = result.verifiedrole
                     serverSettings.unverifiedRoleName = result.unverifiedrole
                     serverSettings.domains = result.domains.split(",").slice(1)
                 }
                 callback(serverSettings)
             }
         )
     }
}

const database = new Database()

module.exports = database


