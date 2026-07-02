const ServerSettings = require('./ServerSettings.js')
const EmailUser = require("./EmailUser");
const sqlite3 = require('sqlite3').verbose()
const md5hash = require("../crypto/Crypto")

class Database {
    constructor() {
        this.db = new sqlite3.Database('config/bot.db');

        // All shard processes open this same file. busy_timeout makes a process wait
        // briefly instead of erroring with SQLITE_BUSY when another shard is writing.
        // WAL lets readers and a writer proceed concurrently. Both pragmas pass an
        // error callback so a transient failure can never raise an unhandled 'error'
        // event and crash the shard — notably, the WAL transition is rejected on the
        // single boot where a schema migration is still in flight, and simply takes
        // effect (persistently) on the next boot instead.
        this.db.run("PRAGMA busy_timeout = 5000", (e) => {
            if (e) console.warn('[DB] busy_timeout pragma not applied:', e.message)
        })
        this.db.run("PRAGMA journal_mode = WAL", (e) => {
            if (e) console.warn('[DB] WAL not applied this boot (takes effect next boot):', e.message)
        })

        this.runMigration(1, () => {
            this.db.run("CREATE TABLE IF NOT EXISTS guilds(guildid INT PRIMARY KEY,domains TEXT, verifiedrole TEXT,unverifiedrole Text, channelid TEXT, messageid TEXT, language TEXT);")
            this.db.run("CREATE TABLE IF NOT EXISTS userEmails(email TEXT,userID TEXT, guildID TEXT, groupID TEXT,isPublic INTEGER, PRIMARY KEY (email, guildID));")
        })
        this.runMigration(2, () => {
            this.db.each("SELECT email, guildID FROM userEmails", (err, result) => {
                this.db.run("UPDATE userEmails SET email = ? WHERE email = ? AND guildID = ?;", [md5hash(result.email), result.email, result.guildID])
            })
        })
        this.runMigration(3, () => {
            this.db.run("ALTER TABLE guilds ADD autoVerify NUMBER DEFAULT 0")
            this.db.run("ALTER TABLE guilds ADD autoAddUnverified NUMBER DEFAULT 0")
        })
        this.runMigration(4, () => {
            this.db.run("ALTER TABLE guilds ADD verifyMessage TEXT DEFAULT ''")
        })
        this.runMigration(5, () => {
            this.db.run("ALTER TABLE guilds ADD logChannel TEXT DEFAULT ''")
        })
        this.runMigration(6, () => {
            this.db.run("ALTER TABLE guilds ADD blacklist TEXT DEFAULT ''")
            })
        this.runMigration(7, () => {
            this.db.run("ALTER TABLE guilds ADD errorNotifyType TEXT DEFAULT 'owner'")
            this.db.run("ALTER TABLE guilds ADD errorNotifyTarget TEXT DEFAULT ''")
        })
        this.runMigration(8, () => {
            this.db.run(`CREATE TABLE IF NOT EXISTS guild_stats(
                guildID TEXT PRIMARY KEY,
                mailsSentTotal INTEGER DEFAULT 0,
                mailsSentMonth INTEGER DEFAULT 0,
                verificationsTotal INTEGER DEFAULT 0,
                verificationsMonth INTEGER DEFAULT 0,
                statsMonth TEXT DEFAULT ''
            );`)
        })
        this.runMigration(9, () => {
            // Rename language from 'france' to 'french'
            this.db.run("UPDATE guilds SET language = 'french' WHERE language = 'france';")
        })
        this.runMigration(10, () => {
            // Add domain-based roles support
            // defaultRoles: JSON array of role IDs always assigned on verification
            // domainRoles: JSON object mapping domain patterns to arrays of role IDs
            this.db.run("ALTER TABLE guilds ADD defaultRoles TEXT DEFAULT '[]'")
            this.db.run("ALTER TABLE guilds ADD domainRoles TEXT DEFAULT '{}'")
            // Migrate existing verifiedrole to defaultRoles
            this.db.each("SELECT guildid, verifiedrole FROM guilds WHERE verifiedrole IS NOT NULL AND verifiedrole != ''", (err, result) => {
                if (!err && result && result.verifiedrole) {
                    const defaultRoles = JSON.stringify([result.verifiedrole])
                    this.db.run("UPDATE guilds SET defaultRoles = ? WHERE guildid = ?", [defaultRoles, result.guildid])
                }
            })
        })
        this.runMigration(11, () => {
            // Migrate domains and blacklist from comma-separated strings to JSON arrays
            this.db.each("SELECT guildid, domains, blacklist FROM guilds", (err, result) => {
                if (!err && result) {
                    // Convert domains from comma-separated to JSON
                    let domainsJson = '[]'
                    if (result.domains && result.domains.length > 0) {
                        try {
                            // Check if already JSON
                            JSON.parse(result.domains)
                            domainsJson = result.domains
                        } catch {
                            // Convert comma-separated to JSON array
                            const domainsArray = result.domains.split(',').filter(d => d.length > 0)
                            domainsJson = JSON.stringify(domainsArray)
                        }
                    }
                    
                    // Convert blacklist from comma-separated to JSON
                    let blacklistJson = '[]'
                    if (result.blacklist && result.blacklist.length > 0) {
                        try {
                            // Check if already JSON
                            JSON.parse(result.blacklist)
                            blacklistJson = result.blacklist
                        } catch {
                            // Convert comma-separated to JSON array
                            const blacklistArray = result.blacklist.split(',').filter(b => b.length > 0)
                            blacklistJson = JSON.stringify(blacklistArray)
                        }
                    }
                    
                    this.db.run("UPDATE guilds SET domains = ?, blacklist = ? WHERE guildid = ?", 
                        [domainsJson, blacklistJson, result.guildid])
                }
            })
        })
        this.runMigration(12, () => {
            // Add allowed emails list for CSV upload feature
            this.db.run("ALTER TABLE guilds ADD allowedEmails TEXT DEFAULT '[]'")
        })
        this.runMigration(13, () => {
            // Premium / monetization: per-guild purchased credits and one-time CSV unlock
            this.db.run(`CREATE TABLE IF NOT EXISTS guild_premium(
                guildID TEXT PRIMARY KEY,
                bonusCredits INTEGER DEFAULT 0,
                csvUnlocked INTEGER DEFAULT 0
            );`)
        })
        this.runMigration(14, () => {
            // Quota warning flags: idempotent thresholds for mobile-data-style reminders
            this.db.run("ALTER TABLE guild_stats ADD warned80 INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warned95 INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warned100 INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warnedCreditsLow INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warnedCreditsZero INTEGER DEFAULT 0")
        })
        this.runMigration(15, () => {
            // Per-guild email rendering style: 'plain' (default) or 'styled' (HTML)
            this.db.run("ALTER TABLE guilds ADD emailStyle TEXT DEFAULT 'plain'")
        })
        this.runMigration(16, () => {
            // Hash any existing plaintext entries in guilds.allowedEmails for parity
            // with userEmails (which has been hashed since migration 2).
            this.db.each("SELECT guildid, allowedEmails FROM guilds WHERE allowedEmails IS NOT NULL AND allowedEmails != '' AND allowedEmails != '[]'", (err, result) => {
                if (err || !result) return
                let parsed
                try { parsed = JSON.parse(result.allowedEmails) } catch { return }
                if (!Array.isArray(parsed) || parsed.length === 0) return
                // Plaintext emails always contain '@'; MD5 base64 hashes don't.
                const hashed = parsed.map(entry => {
                    if (typeof entry !== 'string') return null
                    return entry.includes('@') ? md5hash(entry.toLowerCase()) : entry
                }).filter(Boolean)
                const dedup = Array.from(new Set(hashed))
                this.db.run("UPDATE guilds SET allowedEmails = ? WHERE guildid = ?", [JSON.stringify(dedup), result.guildid])
            })
        })
        this.runMigration(17, () => {
            // Error notification redesign: per-user opt-in DMs, separate channel + ping config.
            // Legacy errorNotifyType/errorNotifyTarget remain on the table and are migrated on read.
            this.db.run("ALTER TABLE guilds ADD errorNotifyChannel TEXT DEFAULT ''")
            this.db.run("ALTER TABLE guilds ADD errorNotifyPing TEXT DEFAULT 'none'")
            this.db.run("ALTER TABLE guilds ADD errorNotifyUsers TEXT DEFAULT '[]'")
            this.db.run("ALTER TABLE guilds ADD errorNotifyOwnerOptedOut INTEGER DEFAULT 0")
        })
        this.runMigration(18, () => {
            // Per-guild mail-mode toggle for non-subscribed guilds:
            //   'free'      (default): 25 self-SMTP sends/month, then credits if any
            //   'zeptomail' (opt-in):  no free quota, every send via ZeptoMail and burns 1 credit;
            //                          auto-flips back to 'free' when credits hit 0
            // Ignored while a subscription is active (subscriptions always use ZeptoMail).
            this.db.run("ALTER TABLE guild_premium ADD mailMode TEXT DEFAULT 'free'")
        })
        this.runMigration(19, () => {
            // Pending verification codes. Previously kept in an in-memory Map, which
            // (a) lost every in-flight verification on restart, and (b) was unreachable
            // from the shard a DM interaction lands on (always shard 0). Persisting here
            // makes the flow restart-safe and shard-agnostic, and lets us enforce a code
            // TTL and a max-attempts cap that the old map could not.
            this.db.run(`CREATE TABLE IF NOT EXISTS pending_verifications(
                userID TEXT NOT NULL,
                guildID TEXT NOT NULL,
                code TEXT NOT NULL,
                emailHash TEXT NOT NULL,
                logEmail TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                lastSentAt INTEGER DEFAULT 0,
                expiresAt INTEGER NOT NULL,
                PRIMARY KEY (userID, guildID)
            );`)
        })
        this.runMigration(20, () => {
            // Revenue funnel: count verification attempts denied by the mail quota so
            // admins can see the demand they're losing ("N members were turned away"),
            // plus idempotent escalation flags for the 1st/5th/20th denial notifications.
            this.db.run("ALTER TABLE guild_stats ADD mailsDeniedMonth INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warnedDenied1 INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warnedDenied5 INTEGER DEFAULT 0")
            this.db.run("ALTER TABLE guild_stats ADD warnedDenied20 INTEGER DEFAULT 0")
        })
    }

    /**
     * Register a migration. Migrations are queued in registration order and applied
     * strictly one after another by #applyMigrations — the old fire-and-forget version
     * check let all pending migrations race each other on a fresh database (every
     * check read user_version 0 concurrently), running e.g. ALTER TABLE before the
     * CREATE TABLE migration had committed and crashing first-time installs.
     */
    runMigration(version, migration) {
        if (!this.pendingMigrations) {
            this.pendingMigrations = []
            // Defer the runner one tick so every constructor registration lands first.
            setImmediate(() => this.applyMigrations())
        }
        this.pendingMigrations.push({ version, migration })
    }

    applyMigrations() {
        // Sort by version so a registration-order mistake can never skip a migration
        // (user_version only moves forward).
        const queue = (this.pendingMigrations || []).slice().sort((a, b) => a.version - b.version)
        const runNext = (index) => {
            if (index >= queue.length) return
            const { version, migration } = queue[index]
            this.db.get("PRAGMA user_version;", (err, result) => {
                if (err) {
                    throw err
                }
                if (result.user_version < version) {
                    console.log("Run Migration: " + version)
                    this.db.serialize(() => {
                        migration()
                    })
                    console.log("Finished: " + version)
                    // The version bump is queued after the migration's statements on the
                    // same connection; its callback marks this migration complete.
                    this.db.run(`PRAGMA user_version = ${version}`, () => runNext(index + 1))
                } else {
                    runNext(index + 1)
                }
            })
        }
        runNext(0)
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
            "INSERT OR REPLACE INTO guilds (guildid, domains, blacklist, verifiedrole, unverifiedrole, channelid, messageid, language, autoVerify, autoAddUnverified, verifyMessage, logChannel, errorNotifyType, errorNotifyTarget, errorNotifyChannel, errorNotifyPing, errorNotifyUsers, errorNotifyOwnerOptedOut, defaultRoles, domainRoles, allowedEmails, emailStyle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [guildID, JSON.stringify(serverSettings.domains), JSON.stringify(serverSettings.blacklist), serverSettings.verifiedRoleName, serverSettings.unverifiedRoleName, serverSettings.channelID, serverSettings.messageID, serverSettings.language, serverSettings.autoVerify, serverSettings.autoAddUnverified, serverSettings.verifyMessage, serverSettings.logChannel, serverSettings.errorNotifyType, serverSettings.errorNotifyTarget, serverSettings.errorNotifyChannel || '', serverSettings.errorNotifyPing || 'none', JSON.stringify(serverSettings.errorNotifyUsers || []), serverSettings.errorNotifyOwnerOptedOut ? 1 : 0, JSON.stringify(serverSettings.defaultRoles), JSON.stringify(serverSettings.domainRoles), JSON.stringify(serverSettings.allowedEmails), serverSettings.emailStyle || 'plain'])
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
                    serverSettings.autoVerify = result.autoVerify
                    serverSettings.autoAddUnverified = result.autoAddUnverified
                    serverSettings.verifyMessage = result.verifyMessage
                    serverSettings.logChannel = result.logChannel
                    serverSettings.errorNotifyType = result.errorNotifyType || "owner"
                    serverSettings.errorNotifyTarget = result.errorNotifyTarget || ""
                    serverSettings.errorNotifyChannel = result.errorNotifyChannel || ""
                    serverSettings.errorNotifyPing = result.errorNotifyPing || "none"
                    serverSettings.errorNotifyOwnerOptedOut = result.errorNotifyOwnerOptedOut ? 1 : 0
                    try {
                        serverSettings.errorNotifyUsers = result.errorNotifyUsers ? JSON.parse(result.errorNotifyUsers) : []
                    } catch {
                        serverSettings.errorNotifyUsers = []
                    }
                    if (!Array.isArray(serverSettings.errorNotifyUsers)) {
                        serverSettings.errorNotifyUsers = []
                    }

                    // One-time read-side migration from legacy errorNotifyType/errorNotifyTarget.
                    // We only fill new fields if the explicit new values are empty so we don't
                    // overwrite anything an admin has set via the new command.
                    if (serverSettings.errorNotifyType === 'channel' && serverSettings.errorNotifyTarget && !serverSettings.errorNotifyChannel) {
                        serverSettings.errorNotifyChannel = serverSettings.errorNotifyTarget
                    }
                    if (serverSettings.errorNotifyType === 'user' && serverSettings.errorNotifyTarget && !serverSettings.errorNotifyUsers.includes(serverSettings.errorNotifyTarget)) {
                        serverSettings.errorNotifyUsers.push(serverSettings.errorNotifyTarget)
                    }
                    
                    // Parse domains (JSON array, with fallback for legacy comma-separated format)
                    try {
                        serverSettings.domains = result.domains ? JSON.parse(result.domains) : []
                    } catch {
                        // Fallback to comma-separated format for backward compatibility
                        serverSettings.domains = result.domains ? result.domains.split(",").filter(d => d.length !== 0) : []
                    }
                    
                    // Parse blacklist (JSON array, with fallback for legacy comma-separated format)
                    try {
                        serverSettings.blacklist = result.blacklist ? JSON.parse(result.blacklist) : []
                    } catch {
                        // Fallback to comma-separated format for backward compatibility
                        serverSettings.blacklist = result.blacklist ? result.blacklist.split(",").filter(b => b.length !== 0) : []
                    }
                    
                    // Parse defaultRoles (JSON array)
                    try {
                        serverSettings.defaultRoles = result.defaultRoles ? JSON.parse(result.defaultRoles) : []
                    } catch {
                        serverSettings.defaultRoles = []
                    }
                    
                    // Parse domainRoles (JSON object)
                    try {
                        serverSettings.domainRoles = result.domainRoles ? JSON.parse(result.domainRoles) : {}
                    } catch {
                        serverSettings.domainRoles = {}
                    }
                    
                    // Parse allowedEmails (JSON array)
                    try {
                        serverSettings.allowedEmails = result.allowedEmails ? JSON.parse(result.allowedEmails) : []
                    } catch {
                        serverSettings.allowedEmails = []
                    }

                    serverSettings.emailStyle = result.emailStyle === 'styled' ? 'styled' : 'plain'
                    
                    // Legacy migration: if defaultRoles is empty but verifiedRoleName exists, use it
                    if (serverSettings.defaultRoles.length === 0 && serverSettings.verifiedRoleName) {
                        serverSettings.defaultRoles = [serverSettings.verifiedRoleName]
                    }
                }
                callback(serverSettings)
            }
        )
    }

    updateEmailUser(emailUser) {
        this.db.run(
            "INSERT OR REPLACE INTO userEmails (email, userID, guildID, groupID, isPublic) VALUES (?, ?, ?, ?, ?)",
            [emailUser.email, emailUser.userID, emailUser.guildID, emailUser.groupID, emailUser.isPublic])
    }

    getEmailUser(email, guildID, callback) {
        this.db.get("SELECT * FROM userEmails WHERE guildID = ? AND email = ?", [guildID, email], (err, result) => {
                if (err) {
                    throw err;
                }
                if (result !== undefined) {
                    callback(new EmailUser(result.email, result.userID, result.guildID, result.groupID, result.isPublic))
                }
            }
        )
    }

    /**
     * Store (or replace) a pending verification code for a user in a guild.
     * Replacing resets the attempt counter, so re-requesting a code gives a clean slate.
     * @param {string} userID
     * @param {string} guildID
     * @param {{code: string, emailHash: string, logEmail: string, expiresAt: number}} data
     */
    setPendingVerification(userID, guildID, { code, emailHash, logEmail, expiresAt }) {
        return new Promise((resolve) => {
            this.db.run(
                "INSERT OR REPLACE INTO pending_verifications (userID, guildID, code, emailHash, logEmail, attempts, lastSentAt, expiresAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
                [userID, guildID, code, emailHash, logEmail, Date.now(), expiresAt],
                (err) => {
                    if (err) console.error('Error storing pending verification:', err)
                    resolve()
                }
            )
        })
    }

    /**
     * Fetch a pending verification. Returns null if none exists or it has expired
     * (expired rows are deleted on read so they don't accumulate).
     */
    getPendingVerification(userID, guildID) {
        return new Promise((resolve) => {
            this.db.get(
                "SELECT * FROM pending_verifications WHERE userID = ? AND guildID = ?",
                [userID, guildID],
                (err, row) => {
                    if (err) {
                        console.error('Error reading pending verification:', err)
                        resolve(null)
                        return
                    }
                    if (!row) {
                        resolve(null)
                        return
                    }
                    if (typeof row.expiresAt === 'number' && row.expiresAt < Date.now()) {
                        this.deletePendingVerification(userID, guildID)
                        resolve(null)
                        return
                    }
                    resolve(row)
                }
            )
        })
    }

    /**
     * Atomically increment the attempt counter (single UPDATE … RETURNING statement).
     * Resolves the new attempt count, `null` if the row no longer exists (consumed or
     * expired), or the string 'error' on a DB failure — callers must fail closed on
     * 'error' rather than treating it as "not at the cap".
     */
    incrementPendingAttempts(userID, guildID) {
        return new Promise((resolve) => {
            this.db.get(
                "UPDATE pending_verifications SET attempts = attempts + 1 WHERE userID = ? AND guildID = ? RETURNING attempts",
                [userID, guildID],
                (err, row) => {
                    if (err) {
                        console.error('Error incrementing verification attempts:', err)
                        resolve('error')
                        return
                    }
                    resolve(row ? row.attempts : null)
                }
            )
        })
    }

    /**
     * Delete a pending verification. Resolves true only if this call actually removed
     * the row — the atomic "consume" primitive that prevents the same code from being
     * accepted twice by concurrent submissions (e.g. DM modal on shard 0 racing the
     * guild-channel modal on the owning shard).
     */
    deletePendingVerification(userID, guildID) {
        return new Promise((resolve) => {
            this.db.run(
                "DELETE FROM pending_verifications WHERE userID = ? AND guildID = ?",
                [userID, guildID],
                function (err) {
                    if (err) {
                        console.error('Error deleting pending verification:', err)
                        resolve(false)
                        return
                    }
                    resolve(this.changes > 0)
                }
            )
        })
    }

    /** Delete all expired pending verifications. Run periodically from the primary shard. */
    sweepExpiredPendingVerifications() {
        return new Promise((resolve) => {
            this.db.run(
                "DELETE FROM pending_verifications WHERE expiresAt < ?",
                [Date.now()],
                function (err) {
                    if (err) {
                        console.error('Error sweeping expired pending verifications:', err)
                        resolve(0)
                        return
                    }
                    resolve(this.changes || 0)
                }
            )
        })
    }

    getCurrentMonth() {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    getGuildStats(guildID, callback) {
        const currentMonth = this.getCurrentMonth()
        this.db.get("SELECT * FROM guild_stats WHERE guildID = ?", [guildID], (err, result) => {
            if (err) {
                console.error('Error getting guild stats:', err)
                callback({ mailsSentTotal: 0, mailsSentMonth: 0, verificationsTotal: 0, verificationsMonth: 0, mailsDeniedMonth: 0, warned80: 0, warned95: 0, warned100: 0, warnedCreditsLow: 0, warnedCreditsZero: 0 })
                return
            }
            if (result === undefined) {
                callback({ mailsSentTotal: 0, mailsSentMonth: 0, verificationsTotal: 0, verificationsMonth: 0, mailsDeniedMonth: 0, warned80: 0, warned95: 0, warned100: 0, warnedCreditsLow: 0, warnedCreditsZero: 0 })
                return
            }
            const warnedCreditsLow = result.warnedCreditsLow || 0
            const warnedCreditsZero = result.warnedCreditsZero || 0
            // Reset monthly counters (and monthly warned flags) if month changed
            if (result.statsMonth !== currentMonth) {
                callback({
                    mailsSentTotal: result.mailsSentTotal,
                    mailsSentMonth: 0,
                    verificationsTotal: result.verificationsTotal,
                    verificationsMonth: 0,
                    mailsDeniedMonth: 0,
                    warned80: 0,
                    warned95: 0,
                    warned100: 0,
                    warnedCreditsLow,
                    warnedCreditsZero
                })
            } else {
                callback({
                    mailsSentTotal: result.mailsSentTotal,
                    mailsSentMonth: result.mailsSentMonth,
                    verificationsTotal: result.verificationsTotal,
                    verificationsMonth: result.verificationsMonth,
                    mailsDeniedMonth: result.mailsDeniedMonth || 0,
                    warned80: result.warned80 || 0,
                    warned95: result.warned95 || 0,
                    warned100: result.warned100 || 0,
                    warnedCreditsLow,
                    warnedCreditsZero
                })
            }
        })
    }

    incrementMailsSent(guildID) {
        // Fire-and-forget; legacy callers do not await
        this.#incrementMailsSentAwaitable(guildID).catch(err => {
            console.error('Error incrementing mails sent:', err)
        })
    }

    #incrementMailsSentAwaitable(guildID) {
        const currentMonth = this.getCurrentMonth()
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM guild_stats WHERE guildID = ?", [guildID], (err, result) => {
                if (err) return reject(err)
                const cb = (e) => e ? reject(e) : resolve()
                if (result === undefined) {
                    this.db.run(
                        "INSERT INTO guild_stats (guildID, mailsSentTotal, mailsSentMonth, verificationsTotal, verificationsMonth, statsMonth) VALUES (?, 1, 1, 0, 0, ?)",
                        [guildID, currentMonth],
                        cb
                    )
                } else if (result.statsMonth !== currentMonth) {
                    this.db.run(
                        "UPDATE guild_stats SET mailsSentTotal = mailsSentTotal + 1, mailsSentMonth = 1, verificationsMonth = 0, statsMonth = ?, warned80 = 0, warned95 = 0, warned100 = 0, mailsDeniedMonth = 0, warnedDenied1 = 0, warnedDenied5 = 0, warnedDenied20 = 0 WHERE guildID = ?",
                        [currentMonth, guildID],
                        cb
                    )
                } else {
                    this.db.run(
                        "UPDATE guild_stats SET mailsSentTotal = mailsSentTotal + 1, mailsSentMonth = mailsSentMonth + 1 WHERE guildID = ?",
                        [guildID],
                        cb
                    )
                }
            })
        })
    }

    incrementVerifications(guildID) {
        const currentMonth = this.getCurrentMonth()
        this.db.get("SELECT * FROM guild_stats WHERE guildID = ?", [guildID], (err, result) => {
            if (err) {
                console.error('Error incrementing verifications:', err)
                return
            }
            if (result === undefined) {
                // Create new entry
                this.db.run(
                    "INSERT INTO guild_stats (guildID, mailsSentTotal, mailsSentMonth, verificationsTotal, verificationsMonth, statsMonth) VALUES (?, 0, 0, 1, 1, ?)",
                    [guildID, currentMonth]
                )
            } else if (result.statsMonth !== currentMonth) {
                // Reset monthly counter for new month (also resets monthly quota warned flags)
                this.db.run(
                    "UPDATE guild_stats SET verificationsTotal = verificationsTotal + 1, verificationsMonth = 1, mailsSentMonth = 0, statsMonth = ?, warned80 = 0, warned95 = 0, warned100 = 0, mailsDeniedMonth = 0, warnedDenied1 = 0, warnedDenied5 = 0, warnedDenied20 = 0 WHERE guildID = ?",
                    [currentMonth, guildID]
                )
            } else {
                // Increment both counters
                this.db.run(
                    "UPDATE guild_stats SET verificationsTotal = verificationsTotal + 1, verificationsMonth = verificationsMonth + 1 WHERE guildID = ?",
                    [guildID]
                )
            }
        })
    }

    getAllGuildStats() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM guild_stats", [], (err, rows) => {
                if (err) {
                    console.error('Error getting all guild stats:', err)
                    reject(err)
                    return
                }
                resolve(rows || [])
            })
        })
    }

    getGuildPremium(guildID) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM guild_premium WHERE guildID = ?", [guildID], (err, result) => {
                if (err) {
                    console.error('Error getting guild premium:', err)
                    resolve({ bonusCredits: 0, csvUnlocked: false, mailMode: 'free' })
                    return
                }
                if (result === undefined) {
                    resolve({ bonusCredits: 0, csvUnlocked: false, mailMode: 'free' })
                } else {
                    const mailMode = result.mailMode === 'zeptomail' ? 'zeptomail' : 'free'
                    resolve({ bonusCredits: result.bonusCredits, csvUnlocked: !!result.csvUnlocked, mailMode })
                }
            })
        })
    }

    setGuildMailMode(guildID, mode) {
        const normalized = mode === 'zeptomail' ? 'zeptomail' : 'free'
        return new Promise((resolve) => {
            this.db.run(
                "INSERT INTO guild_premium (guildID, mailMode) VALUES (?, ?) ON CONFLICT(guildID) DO UPDATE SET mailMode = ?",
                [guildID, normalized, normalized],
                (err) => {
                    if (err) console.error('Error setting guild mail mode:', err)
                    resolve()
                }
            )
        })
    }

    /**
     * Atomic mailMode flip 'zeptomail' → 'free'. Resolves true exactly once per
     * disable event (subsequent calls find the row already on 'free' and resolve false),
     * so the caller can fire the owner notification without an extra dedup flag.
     */
    tryAutoDisableZeptoMode(guildID) {
        return new Promise((resolve) => {
            this.db.run(
                "UPDATE guild_premium SET mailMode = 'free' WHERE guildID = ? AND mailMode = 'zeptomail'",
                [guildID],
                function (err) {
                    if (err) {
                        console.error('Error auto-disabling zepto mode:', err)
                        resolve(false)
                        return
                    }
                    resolve(this.changes > 0)
                }
            )
        })
    }

    addGuildCredits(guildID, amount) {
        return new Promise((resolve, reject) => {
            this.db.run(
                "INSERT INTO guild_premium (guildID, bonusCredits) VALUES (?, ?) ON CONFLICT(guildID) DO UPDATE SET bonusCredits = bonusCredits + ?",
                [guildID, amount, amount],
                (err) => {
                    if (err) {
                        console.error('Error adding guild credits:', err)
                        reject(err)
                        return
                    }
                    // Reset credit-related warning flags so admins get notified again on next exhaustion
                    this.db.run(
                        "UPDATE guild_stats SET warnedCreditsLow = 0, warnedCreditsZero = 0 WHERE guildID = ?",
                        [guildID],
                        () => resolve()
                    )
                }
            )
        })
    }

    /**
     * Atomic increment + threshold-flag check. Returns the crossings that should trigger
     * admin notifications. Each flag transitions 0 → 1 exactly once per period (month for
     * the quota flags, until next top-up for the credit flags) thanks to a single
     * `UPDATE ... WHERE flag = 0` query.
     *
     * @param {string} guildID
     * @param {string} source - 'free' | 'credits' | 'credits-zepto' | 'subscription' | 'disabled'
     * @param {number} freeLimit
     */
    async recordMailSentAndCheckThresholds(guildID, source, freeLimit) {
        await this.#incrementMailsSentAwaitable(guildID)

        const out = {
            crossed80: false,
            crossed95: false,
            crossed100: false,
            crossedCreditsLow: false,
            crossedCreditsZero: false,
            mailsSentMonth: null,
            creditsRemaining: null
        }

        if (source === 'subscription' || source === 'disabled') {
            return out
        }

        if (source === 'free') {
            const stats = await new Promise(resolve => this.getGuildStats(guildID, resolve))
            out.mailsSentMonth = stats.mailsSentMonth
            const threshold80 = Math.ceil(freeLimit * 0.8)
            const threshold95 = Math.ceil(freeLimit * 0.95)

            out.crossed80 = await this.#tripFlag(guildID, 'warned80', threshold80)
            out.crossed95 = await this.#tripFlag(guildID, 'warned95', threshold95)
            out.crossed100 = await this.#tripFlag(guildID, 'warned100', freeLimit)
            return out
        }

        if (source === 'credits' || source === 'credits-zepto') {
            const premium = await this.getGuildPremium(guildID)
            out.creditsRemaining = premium.bonusCredits

            if (premium.bonusCredits <= 0) {
                out.crossedCreditsZero = await this.#tripCreditFlag(guildID, 'warnedCreditsZero')
                if (out.crossedCreditsZero) {
                    out.crossedCreditsLow = await this.#tripCreditFlag(guildID, 'warnedCreditsLow')
                }
            } else if (premium.bonusCredits <= 10) {
                out.crossedCreditsLow = await this.#tripCreditFlag(guildID, 'warnedCreditsLow')
            }
            return out
        }

        return out
    }

    // Column names come from internal call sites only — never user input.
    #tripFlag(guildID, column, threshold, counterColumn = 'mailsSentMonth') {
        return new Promise((resolve) => {
            this.db.run(
                `UPDATE guild_stats SET ${column} = 1 WHERE guildID = ? AND ${column} = 0 AND ${counterColumn} >= ?`,
                [guildID, threshold],
                function (err) {
                    if (err) {
                        console.error(`Error tripping flag ${column}:`, err)
                        resolve(false)
                        return
                    }
                    resolve(this.changes > 0)
                }
            )
        })
    }

    /**
     * Record a verification attempt denied by the mail quota and check the escalating
     * notification thresholds (1st, 5th, 20th denial per month). Same idempotent
     * flag pattern as the quota warnings: each flag trips 0 → 1 exactly once per month.
     * Returns { deniedMonth, crossed1, crossed5, crossed20 }.
     */
    async recordMailDeniedAndCheckThresholds(guildID) {
        const currentMonth = this.getCurrentMonth()
        await new Promise((resolve, reject) => {
            this.db.get("SELECT * FROM guild_stats WHERE guildID = ?", [guildID], (err, result) => {
                if (err) return reject(err)
                const cb = (e) => e ? reject(e) : resolve()
                if (result === undefined) {
                    this.db.run(
                        "INSERT INTO guild_stats (guildID, mailsDeniedMonth, statsMonth) VALUES (?, 1, ?)",
                        [guildID, currentMonth],
                        cb
                    )
                } else if (result.statsMonth !== currentMonth) {
                    this.db.run(
                        "UPDATE guild_stats SET mailsDeniedMonth = 1, mailsSentMonth = 0, verificationsMonth = 0, statsMonth = ?, warned80 = 0, warned95 = 0, warned100 = 0, warnedDenied1 = 0, warnedDenied5 = 0, warnedDenied20 = 0 WHERE guildID = ?",
                        [currentMonth, guildID],
                        cb
                    )
                } else {
                    this.db.run(
                        "UPDATE guild_stats SET mailsDeniedMonth = mailsDeniedMonth + 1 WHERE guildID = ?",
                        [guildID],
                        cb
                    )
                }
            })
        })

        const out = { deniedMonth: null, crossed1: false, crossed5: false, crossed20: false }
        out.crossed1 = await this.#tripFlag(guildID, 'warnedDenied1', 1, 'mailsDeniedMonth')
        out.crossed5 = await this.#tripFlag(guildID, 'warnedDenied5', 5, 'mailsDeniedMonth')
        out.crossed20 = await this.#tripFlag(guildID, 'warnedDenied20', 20, 'mailsDeniedMonth')
        const stats = await new Promise(resolve => this.getGuildStats(guildID, resolve))
        out.deniedMonth = stats.mailsDeniedMonth
        return out
    }

    #tripCreditFlag(guildID, column) {
        return new Promise((resolve) => {
            this.db.run(
                `INSERT INTO guild_stats (guildID, ${column}, statsMonth) VALUES (?, 1, ?)
                 ON CONFLICT(guildID) DO UPDATE SET ${column} = 1 WHERE ${column} = 0`,
                [guildID, this.getCurrentMonth()],
                function (err) {
                    if (err) {
                        console.error(`Error tripping credit flag ${column}:`, err)
                        resolve(false)
                        return
                    }
                    resolve(this.changes > 0)
                }
            )
        })
    }

    consumeGuildCredit(guildID) {
        return new Promise((resolve, reject) => {
            this.db.run(
                "UPDATE guild_premium SET bonusCredits = bonusCredits - 1 WHERE guildID = ? AND bonusCredits > 0",
                [guildID],
                function (err) {
                    if (err) {
                        console.error('Error consuming guild credit:', err)
                        resolve(false)
                        return
                    }
                    resolve(this.changes > 0)
                }
            )
        })
    }

    /**
     * Refund a previously-consumed credit. Used when a send is admitted via a credit
     * but the email provider then fails — the credit shouldn't be lost since no
     * verification mail was actually delivered.
     */
    refundGuildCredit(guildID) {
        return new Promise((resolve) => {
            this.db.run(
                "INSERT INTO guild_premium (guildID, bonusCredits) VALUES (?, 1) ON CONFLICT(guildID) DO UPDATE SET bonusCredits = bonusCredits + 1",
                [guildID],
                (err) => {
                    if (err) console.error('Error refunding guild credit:', err)
                    resolve()
                }
            )
        })
    }

    unlockGuildCSV(guildID) {
        return new Promise((resolve, reject) => {
            this.db.run(
                "INSERT INTO guild_premium (guildID, csvUnlocked) VALUES (?, 1) ON CONFLICT(guildID) DO UPDATE SET csvUnlocked = 1",
                [guildID],
                (err) => {
                    if (err) {
                        console.error('Error unlocking guild CSV:', err)
                        reject(err)
                        return
                    }
                    resolve()
                }
            )
        })
    }
}

const database = new Database()

module.exports = database


