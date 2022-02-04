const ServerSettings = require('./ServerSettings.js')
const EmailUser = require("./EmailUser");
const sqlite3 = require('sqlite3').verbose()
const md5hash = require("../crypto/Crypto")

class Database {
    constructor() {
        this.db = new sqlite3.Database('bot.db');
        this.db.serialize(() => {
                this.runMigration(1, () => {
                    this.db.run("CREATE TABLE IF NOT EXISTS guilds(guildid INT PRIMARY KEY,domains TEXT,verifiedrole TEXT,unverifiedrole Text, channelid TEXT, messageid TEXT, language TEXT);")
                    this.db.run("CREATE TABLE IF NOT EXISTS userEmails(email TEXT,userID TEXT, guildID TEXT, groupID TEXT,isPublic INTEGER, PRIMARY KEY (email, guildID));")
                })
                this.runMigration(2, () => {
                    this.db.each("SELECT email, guildID FROM userEmails", (err, result) => {
                        this.db.run("UPDATE userEmails SET email = ? WHERE email = ? AND guildID = ?;", [md5hash(result.email), result.email, result.guildID])
                    })
                })
            }
        )
    }

    runMigration(version, migration) {
        this.db.get("PRAGMA user_version;", (err, result) => {
            if (err) {
                throw err
            }
            if (result.user_version < version) {
                console.log("Run Migration: " + version)
                migration()
                this.db.run(`PRAGMA user_version = ${version}`)
            }
        })
    }

    deleteUserData(userID) {
        this.db.run("DELETE FROM userEmails WHERE userID = ?;", [userID])
    }

    deleteServerData(guildID) {
        this.db.run("DELETE FROM guilds WHERE guildid = ?;", [guildID])
        this.db.run("DELETE FROM userEmails WHERE guildID = ?;", [guildID])
    }


    updateServerSettings(guildID, serverSettings) {
        this.db.run(
            "INSERT OR REPLACE INTO guilds (guildid, domains, verifiedrole, unverifiedrole, channelid, messageid, language) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [guildID, serverSettings.domains.toString(), serverSettings.verifiedRoleName, serverSettings.unverifiedRoleName, serverSettings.channelID, serverSettings.messageID, serverSettings.language])
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
                    serverSettings.language = result.language
                    serverSettings.domains = result.domains.split(",").filter((domain) => domain.length !== 0)
                }
                callback(serverSettings)
            }
        )
    }
    updateEmailUser(emailUser) {
        this.db.run(
            "INSERT OR REPLACE INTO userEmails (email, userID, guildID, groupID, isPublic) VALUES (?, ?, ?, ?, ?)",
            [emailUser.email.toLowerCase(), emailUser.userID, emailUser.guildID, emailUser.groupID, emailUser.isPublic])
    }

    getEmailUser(email, guildID, callback) {
        this.db.get("SELECT * FROM userEmails WHERE guildID = ? AND email = ?", [guildID, email.toLowerCase()], (err, result) => {
                if (err) {
                    throw err;
                }
                if (result !== undefined) {
                    callback(new EmailUser(result.email, result.userID, result.guildID, result.groupID, result.isPublic))
                }
            }
        )
    }
}

const database = new Database()

module.exports = database


