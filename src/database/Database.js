// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const ServerSettings = require('./ServerSettings.js')
const EmailUser = require("./EmailUser");
const sqlite3 = require('sqlite3').verbose()
const md5hash = require("../crypto/Crypto")
const { DB_PATH, databaseKey, keyPragma, isPlaintext } = require('./DatabaseEncryption.js')

// guilds columns written by updateServerSettings (guildid aside).
const SETTINGS_COLUMNS = ['domains', 'blacklist', 'verifiedrole', 'unverifiedrole', 'channelid', 'messageid', 'language', 'autoVerify', 'autoAddUnverified', 'verifyMessage', 'logChannel', 'errorNotifyType', 'errorNotifyTarget', 'errorNotifyChannel', 'errorNotifyPing', 'errorNotifyUsers', 'errorNotifyOwnerOptedOut', 'defaultRoles', 'domainRoles', 'allowedEmails', 'emailStyle']

/** A ServerSettings object as the column values updateServerSettings stores. */
function settingsRow(serverSettings) {
    return {
        domains: JSON.stringify(serverSettings.domains),
        blacklist: JSON.stringify(serverSettings.blacklist),
        verifiedrole: serverSettings.verifiedRoleName,
        unverifiedrole: serverSettings.unverifiedRoleName,
        channelid: serverSettings.channelID,
        messageid: serverSettings.messageID,
        language: serverSettings.language,
        autoVerify: serverSettings.autoVerify,
        autoAddUnverified: serverSettings.autoAddUnverified,
        verifyMessage: serverSettings.verifyMessage,
        logChannel: serverSettings.logChannel,
        errorNotifyType: serverSettings.errorNotifyType,
        errorNotifyTarget: serverSettings.errorNotifyTarget,
        errorNotifyChannel: serverSettings.errorNotifyChannel || '',
        errorNotifyPing: serverSettings.errorNotifyPing || 'none',
        errorNotifyUsers: JSON.stringify(serverSettings.errorNotifyUsers || []),
        errorNotifyOwnerOptedOut: serverSettings.errorNotifyOwnerOptedOut ? 1 : 0,
        defaultRoles: JSON.stringify(serverSettings.defaultRoles),
        domainRoles: JSON.stringify(serverSettings.domainRoles),
        allowedEmails: JSON.stringify(serverSettings.allowedEmails),
        emailStyle: serverSettings.emailStyle || null
    }
}

// SQLite hands numbers back for numeric columns; compare loosely across that.
function sameColumnValue(a, b) {
    if (a === b) return true
    if (a === undefined || b === undefined) return false
    return a !== null && b !== null && String(a) === String(b)
}

// What each ServerSettings object held in the database when it was read, keyed by the
// object itself, so updateServerSettings can write only what the caller changed.
const settingsSnapshots = new WeakMap()

class Database {
    constructor() {
        // The sharder encrypts an unencrypted database before any shard starts
        // (DatabaseEncryption.prepareDatabase). Reaching this with a key and a
        // plaintext file means it was skipped; keying would only fail later with
        // "file is not a database" on every query.
        const key = databaseKey()
        if (key && isPlaintext(DB_PATH)) {
            throw new Error(`${DB_PATH} is not encrypted yet. Start the bot through src/sharder.js, which encrypts it first.`)
        }

        this.db = new sqlite3.Database(DB_PATH);

        // SQLCipher needs the key before any other statement touches the file.
        // exec() is always scheduled exclusively, so everything queued after it
        // waits until the connection is keyed.
        if (key) {
            this.db.exec(keyPragma(key), (e) => {
                if (e) {
                    console.error('[DB] Could not apply the encryption key:', e.message)
                    process.exit(1)
                }
            })
        }

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
        this.runMigration(21, () => {
            // Access tokens for the Tier 2 restriction-list API. Only the SHA-256 of the
            // token is stored, so a database leak cannot yield a usable token and the
            // plaintext exists only in the one ephemeral reply that issued it. One token
            // per guild: regenerating replaces the row, which revokes the old token.
            this.db.run(`CREATE TABLE IF NOT EXISTS guild_api_tokens(
                guildID TEXT PRIMARY KEY,
                tokenHash TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                createdBy TEXT,
                lastUsedAt INTEGER
            );`)
            // Authentication looks the token up by hash on every request.
            this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_api_tokens_hash ON guild_api_tokens(tokenHash)")
        })
        this.runMigration(22, () => {
            // Commands moved from per-guild registration to a single global registration.
            // Guilds that joined under the old scheme still hold a guild-scoped copy of
            // every command, which Discord shows alongside the global ones — so each has
            // to be cleared once. This table records which guilds are done, so the sweep
            // costs one API call per guild ever rather than one per guild per restart.
            this.db.run(`CREATE TABLE IF NOT EXISTS guild_command_cleanup(
                guildID TEXT PRIMARY KEY,
                clearedAt INTEGER NOT NULL
            );`)
        })
        this.runMigration(23, () => {
            // Vote rewards. A vote on top.gg or discordbotlist.com raises the free quota
            // of one server for the calendar month it was cast in. The bonus is summed
            // from this log rather than kept as a counter, so it expires with the month
            // by construction and needs no reset logic. guildID is null when a vote
            // could not be attributed to any server; it is still logged for dedupe.
            this.db.run(`CREATE TABLE IF NOT EXISTS votes(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                userID TEXT NOT NULL,
                guildID TEXT,
                month TEXT NOT NULL,
                votedAt INTEGER NOT NULL,
                bonusGranted INTEGER NOT NULL DEFAULT 0
            );`)
            this.db.run("CREATE INDEX IF NOT EXISTS idx_votes_guild_month ON votes(guildID, month)")
            this.db.run("CREATE INDEX IF NOT EXISTS idx_votes_source_user ON votes(source, userID, votedAt)")
            // Votes arrive from the lists with a user id only. This remembers which server
            // each user last ran /vote (or pressed a vote button) in, so the reward lands
            // there — discordbotlist.com passes no custom data through its webhook.
            this.db.run(`CREATE TABLE IF NOT EXISTS vote_targets(
                userID TEXT PRIMARY KEY,
                guildID TEXT NOT NULL,
                updatedAt INTEGER NOT NULL
            );`)
        })
        this.runMigration(24, () => {
            // Setup follow-ups. Half of all new servers never verify anyone, most of them
            // because setup stalls after the welcome message. A row is written only when
            // the bot joins a server, so servers that were already in before this
            // shipped can never be nudged (no mass DMs). It is removed once the server
            // verifies someone, after the last nudge, or when the bot leaves.
            this.db.run(`CREATE TABLE IF NOT EXISTS guild_onboarding(
                guildID TEXT PRIMARY KEY,
                joinedAt INTEGER NOT NULL,
                inviterID TEXT,
                nudgesSent INTEGER NOT NULL DEFAULT 0,
                lastNudgeAt INTEGER
            );`)
        })
        this.runMigration(25, () => {
            // Styled (HTML) emails become the default. emailStyle now holds only an
            // explicit pick, null meaning "the default". Plain was the default until now,
            // so a stored 'plain' almost always means "never chose" and is cleared; the
            // few admins who picked it on purpose can pick it again.
            this.db.run("UPDATE guilds SET emailStyle = NULL WHERE emailStyle = 'plain'")
        })
        this.runMigration(26, () => {
            // A vote no longer raises the whole server's quota: it unlocks verification
            // emails for the voter alone, in the server the vote was for. bonusGranted is
            // now that personal allowance and mailsUsed counts what the voter has spent
            // of it. Votes from before the change carry over as the voter's own allowance
            // for the rest of their month.
            this.db.run("ALTER TABLE votes ADD COLUMN mailsUsed INTEGER NOT NULL DEFAULT 0")
            this.db.run("CREATE INDEX IF NOT EXISTS idx_votes_user_guild_month ON votes(userID, guildID, month)")
        })
        this.runMigration(27, () => {
            // Email-request backoff, shared by every shard. It used to be a per-shard
            // in-memory Map, so a user had one backoff on shard 0 (DM interactions) and
            // another on the guild's own shard, and two submits on different shards both
            // went through. Same escalation as before: 0 → 12 → 60 → 300 seconds.
            this.db.run(`CREATE TABLE IF NOT EXISTS email_rate_limits(
                userID TEXT NOT NULL,
                guildID TEXT NOT NULL,
                waitSeconds INTEGER NOT NULL DEFAULT 0,
                lastAt INTEGER NOT NULL,
                PRIMARY KEY (userID, guildID)
            );`)
            // Displacing a previous holder checks whether they still own another address
            // in the guild, which looks rows up by user.
            this.db.run("CREATE INDEX IF NOT EXISTS idx_userEmails_user_guild ON userEmails(userID, guildID)")
        })
        this.runMigration(28, () => {
            // Consumable redemptions (credit packs, CSV unlock). Redeeming consumes the
            // entitlement on Discord and then grants it here; before this ledger a failed
            // local grant left the entitlement consumed and the guild with nothing, and
            // nothing recorded which entitlement was owed. A row is claimed as
            // 'consuming' before consume(), turned 'granted' in the same transaction as
            // the grant, and rows left in 'consuming' are reconciled against Discord.
            this.db.run(`CREATE TABLE IF NOT EXISTS entitlement_redemptions(
                entitlementID TEXT PRIMARY KEY,
                guildID TEXT NOT NULL,
                userID TEXT NOT NULL,
                skuID TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('credits', 'csv')),
                amount INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL CHECK (status IN ('consuming', 'granted')),
                createdAt INTEGER NOT NULL,
                grantedAt INTEGER
            );`)
            this.db.run("CREATE INDEX IF NOT EXISTS idx_entitlement_redemptions_status ON entitlement_redemptions(status, createdAt)")
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

    /**
     * Every guild in which this user holds a verification row.
     * @param {string} userID
     * @returns {Promise<string[]>}
     */
    getUserGuildIDs(userID) {
        return new Promise((resolve) => {
            this.db.all("SELECT DISTINCT guildID FROM userEmails WHERE userID = ?", [userID], (err, rows) => {
                if (err) {
                    console.error('Error reading user guilds:', err)
                    resolve([])
                    return
                }
                resolve((rows || []).map(row => row.guildID))
            })
        })
    }

    deleteUserData(userID) {
        this.db.run("DELETE FROM userEmails WHERE userID = ?;", [userID])
        this.db.run("DELETE FROM vote_targets WHERE userID = ?;", [userID])
        // A vote only ever rewards the voter, so nothing is left to keep for anyone else.
        this.db.run("DELETE FROM votes WHERE userID = ?;", [userID])
        // A code still pending would otherwise let the user re-verify from a deleted
        // account's address within its TTL.
        this.db.run("DELETE FROM pending_verifications WHERE userID = ?;", [userID])
        this.db.run("DELETE FROM email_rate_limits WHERE userID = ?;", [userID])
    }

    deleteServerData(guildID) {
        this.db.run("DELETE FROM guilds WHERE guildid = ?;", [guildID])
        this.db.run("DELETE FROM userEmails WHERE guildID = ?;", [guildID])
        this.db.run("DELETE FROM votes WHERE guildID = ?;", [guildID])
        this.db.run("DELETE FROM vote_targets WHERE guildID = ?;", [guildID])
        this.db.run("DELETE FROM guild_onboarding WHERE guildID = ?;", [guildID])
        // The API token and pending codes are server data too: a token that survived
        // here would control the allowlist again once the bot is re-added.
        this.db.run("DELETE FROM guild_api_tokens WHERE guildID = ?;", [guildID])
        this.db.run("DELETE FROM pending_verifications WHERE guildID = ?;", [guildID])
        this.db.run("DELETE FROM email_rate_limits WHERE guildID = ?;", [guildID])
    }

    /** Whether the guild has saved settings at all (a fresh join has none). */
    hasServerSettings(guildID) {
        return new Promise((resolve) => {
            this.db.get("SELECT 1 AS found FROM guilds WHERE guildid = ?", [guildID], (err, row) => {
                if (err) console.error('Error checking server settings:', err)
                resolve(!!row)
            })
        })
    }


    /**
     * Save a guild's settings. Only the columns that differ from what was read (by
     * getServerSettings, for this same object) are written, so a command that changes
     * one setting no longer writes back a stale copy of every other one — e.g. /role add
     * overlapping an API call that adds to allowedEmails used to drop the API's entries.
     * An object that wasn't read from an existing row writes every column.
     */
    updateServerSettings(guildID, serverSettings) {
        const row = settingsRow(serverSettings)
        const snapshot = settingsSnapshots.get(serverSettings)
        const columns = snapshot
            ? SETTINGS_COLUMNS.filter(col => !sameColumnValue(row[col], snapshot[col]))
            : SETTINGS_COLUMNS
        settingsSnapshots.set(serverSettings, { ...(snapshot || {}), ...row })
        if (columns.length === 0) return Promise.resolve()
        return new Promise((resolve) => {
            this.db.run(
                `INSERT INTO guilds (guildid, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})
                 ON CONFLICT(guildid) DO UPDATE SET ${columns.map(col => `${col} = excluded.${col}`).join(', ')}`,
                [guildID, ...columns.map(col => row[col])],
                (err) => {
                    if (err) console.error('Error saving server settings:', err)
                    resolve()
                }
            )
        })
    }

    async getServerSettings(guildID, callback) {
        const serverSettings = new ServerSettings()
        await this.db.get("SELECT * FROM guilds WHERE guildid = ?", [guildID], async (err, result) => {
                if (err) {
                    // Throwing here is an unhandled rejection, which exits the whole shard on
                    // Node 26. Calling back with defaults could overwrite the real row, so log
                    // and leave this one interaction unanswered instead.
                    console.error('Error reading server settings:', err)
                    return
                }
                if (result !== undefined) {
                    const snapshot = {}
                    for (const col of SETTINGS_COLUMNS) snapshot[col] = result[col]
                    settingsSnapshots.set(serverSettings, snapshot)
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
                    // Folded in now, so drop the legacy pair: the next save stores the new
                    // fields and clears the old ones. Kept, they were re-applied on every
                    // read, undoing /set_error_notify clear and "me off".
                    serverSettings.errorNotifyType = 'owner'
                    serverSettings.errorNotifyTarget = ''
                    
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

                    serverSettings.emailStyle = ['plain', 'styled'].includes(result.emailStyle) ? result.emailStyle : null
                    
                    // Legacy migration: if defaultRoles is empty but verifiedRoleName exists, use it
                    if (serverSettings.defaultRoles.length === 0 && serverSettings.verifiedRoleName) {
                        serverSettings.defaultRoles = [serverSettings.verifiedRoleName]
                    }
                }
                // Callers pass async callbacks that nobody awaits (db.get does not return a
                // promise), so an error inside one would be an unhandled rejection and exit
                // the shard with every guild on it. Catch it here for all callers.
                try {
                    Promise.resolve(callback(serverSettings)).catch((callbackErr) => {
                        console.error('Error in server settings callback:', callbackErr)
                    })
                } catch (callbackErr) {
                    console.error('Error in server settings callback:', callbackErr)
                }
            }
        )
    }

    /**
     * Record `emailUser.userID` as the owner of the address in the guild. Resolves
     * true once written, false on a DB error (logged), so callers can wait for the
     * ownership change before acting on it.
     */
    updateEmailUser(emailUser) {
        return new Promise((resolve) => {
            this.db.run(
                "INSERT OR REPLACE INTO userEmails (email, userID, guildID, groupID, isPublic) VALUES (?, ?, ?, ?, ?)",
                [emailUser.email, emailUser.userID, emailUser.guildID, emailUser.groupID, emailUser.isPublic],
                (err) => {
                    if (err) console.error('Error storing verified email owner:', err)
                    resolve(!err)
                }
            )
        })
    }

    /**
     * The user who currently owns this address in the guild, or null.
     * Rejects on a DB error so a caller never mistakes it for "no owner".
     */
    getEmailOwnerId(emailHash, guildID) {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT userID FROM userEmails WHERE guildID = ? AND email = ?", [guildID, emailHash], (err, row) => {
                if (err) return reject(err)
                resolve(row ? row.userID : null)
            })
        })
    }

    /** Whether the user still owns any address in the guild. Errs towards true. */
    userHasEmailInGuild(userID, guildID) {
        return new Promise((resolve) => {
            this.db.get("SELECT 1 AS found FROM userEmails WHERE userID = ? AND guildID = ? LIMIT 1", [userID, guildID], (err, row) => {
                if (err) {
                    console.error('Error checking remaining verified emails:', err)
                    return resolve(true)
                }
                resolve(!!row)
            })
        })
    }

    /**
     * Claim one email send against the per-user, per-guild backoff, atomically across
     * shards. Allowed when the previous wait has run out; a claim stamps now and
     * escalates the wait (0 → 12 → 60 → 300 s, then stays at 300).
     *
     * @returns {Promise<{allowed: true, claim: ?Object} | {allowed: false, retryAfterMs: number}>}
     *   `claim` is handed to releaseEmailSend when the send is then not admitted.
     */
    async claimEmailSend(userID, guildID) {
        const now = Date.now()
        const prev = await new Promise((resolve) => {
            this.db.get("SELECT waitSeconds, lastAt FROM email_rate_limits WHERE userID = ? AND guildID = ?", [userID, guildID], (err, row) => {
                resolve(err ? undefined : (row || null))
            })
        })
        const changes = await new Promise((resolve) => {
            this.db.run(
                `INSERT INTO email_rate_limits (userID, guildID, waitSeconds, lastAt) VALUES (?, ?, 12, ?)
                 ON CONFLICT(userID, guildID) DO UPDATE SET
                     waitSeconds = CASE WHEN waitSeconds <= 0 THEN 12 WHEN waitSeconds < 300 THEN waitSeconds * 5 ELSE waitSeconds END,
                     lastAt = excluded.lastAt
                 WHERE lastAt + waitSeconds * 1000 <= excluded.lastAt`,
                [userID, guildID, now],
                function (err) {
                    if (err) {
                        // Fail open: the guild's mail quota still applies, and a broken
                        // limiter must not block every verification.
                        console.error('Error claiming email send slot:', err)
                        return resolve(null)
                    }
                    resolve(this.changes)
                }
            )
        })
        if (changes === null) return { allowed: true, claim: null }
        if (changes > 0) return { allowed: true, claim: { at: now, prev: prev || null } }

        const row = await new Promise((resolve) => {
            this.db.get("SELECT waitSeconds, lastAt FROM email_rate_limits WHERE userID = ? AND guildID = ?", [userID, guildID], (err, r) => resolve(err ? null : r))
        })
        const retryAfterMs = row ? Math.max(1000, row.lastAt + row.waitSeconds * 1000 - now) : 1000
        return { allowed: false, retryAfterMs }
    }

    /**
     * Undo a claim whose send was then not admitted (e.g. the mail quota denied it), so
     * a member turned away for the server's quota isn't pushed into longer waits. Only
     * touches the row while it still holds this claim.
     */
    releaseEmailSend(userID, guildID, claim) {
        if (!claim) return Promise.resolve()
        return new Promise((resolve) => {
            const done = (err) => {
                if (err) console.error('Error releasing email send slot:', err)
                resolve()
            }
            if (claim.prev) {
                this.db.run(
                    "UPDATE email_rate_limits SET waitSeconds = ?, lastAt = ? WHERE userID = ? AND guildID = ? AND lastAt = ?",
                    [claim.prev.waitSeconds, claim.prev.lastAt, userID, guildID, claim.at],
                    done
                )
            } else {
                this.db.run("DELETE FROM email_rate_limits WHERE userID = ? AND guildID = ? AND lastAt = ?", [userID, guildID, claim.at], done)
            }
        })
    }

    /** Reset the backoff once the member has verified. */
    clearEmailRateLimit(userID, guildID) {
        this.db.run("DELETE FROM email_rate_limits WHERE userID = ? AND guildID = ?", [userID, guildID], (err) => {
            if (err) console.error('Error clearing email rate limit:', err)
        })
    }

    /** Drop backoff rows whose wait ran out more than `staleMs` ago. */
    sweepEmailRateLimits(staleMs) {
        return new Promise((resolve) => {
            this.db.run("DELETE FROM email_rate_limits WHERE lastAt + waitSeconds * 1000 < ?", [Date.now() - staleMs], function (err) {
                if (err) console.error('Error sweeping email rate limits:', err)
                resolve(err ? 0 : (this.changes || 0))
            })
        })
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
     * Replacing resets the attempt counter, so a new email request gives a clean slate
     * (those go through the escalating email backoff). With `keepAttempts`, a row that
     * is still there keeps its counter: "Resend code" only has a flat cooldown, so it
     * must not hand out a fresh set of guesses with every resend.
     * Resolves true once stored, false on a DB error (logged): the caller must not tell
     * the member a code is waiting when none was stored.
     * @param {string} userID
     * @param {string} guildID
     * @param {{code: string, emailHash: string, logEmail: string, expiresAt: number}} data
     * @param {{keepAttempts?: boolean}} [options]
     */
    setPendingVerification(userID, guildID, { code, emailHash, logEmail, expiresAt }, { keepAttempts = false } = {}) {
        const sql = keepAttempts
            ? `INSERT INTO pending_verifications (userID, guildID, code, emailHash, logEmail, attempts, lastSentAt, expiresAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
               ON CONFLICT(userID, guildID) DO UPDATE SET code = excluded.code, emailHash = excluded.emailHash, logEmail = excluded.logEmail,
                   lastSentAt = excluded.lastSentAt, expiresAt = excluded.expiresAt`
            : "INSERT OR REPLACE INTO pending_verifications (userID, guildID, code, emailHash, logEmail, attempts, lastSentAt, expiresAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
        return new Promise((resolve) => {
            this.db.run(
                sql,
                [userID, guildID, code, emailHash, logEmail, Date.now(), expiresAt],
                (err) => {
                    if (err) console.error('Error storing pending verification:', err)
                    resolve(!err)
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

    /**
     * Start a new stats month for the guild if its row is from an earlier one (or
     * create the row). One atomic upsert, and the only place the monthly counters and
     * flags are reset, so every writer below agrees on what a rollover clears — and two
     * shards rolling over at once can't wipe each other's increments.
     * getGuildStats mirrors this for reads of a row that hasn't rolled over yet.
     */
    #rollStatsMonth(guildID) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO guild_stats (guildID, statsMonth) VALUES (?, ?)
                 ON CONFLICT(guildID) DO UPDATE SET
                     mailsSentMonth = 0, verificationsMonth = 0, mailsDeniedMonth = 0,
                     warned80 = 0, warned95 = 0, warned100 = 0,
                     warnedDenied1 = 0, warnedDenied5 = 0, warnedDenied20 = 0,
                     statsMonth = excluded.statsMonth
                 WHERE statsMonth IS NOT excluded.statsMonth`,
                [guildID, this.getCurrentMonth()],
                (err) => err ? reject(err) : resolve()
            )
        })
    }

    #runStats(sql, params) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) return reject(err)
                resolve(this.changes)
            })
        })
    }

    /**
     * Count a sent mail. `source` is the admission source from canSendMail: a 'free'
     * send already took its slot in mailsSentMonth when it was admitted
     * (reserveFreeMail), so only the total is counted here.
     */
    incrementMailsSent(guildID, source = null) {
        // Fire-and-forget; legacy callers do not await
        this.#incrementMailsSentAwaitable(guildID, source !== 'free').catch(err => {
            console.error('Error incrementing mails sent:', err)
        })
    }

    async #incrementMailsSentAwaitable(guildID, countMonth = true) {
        await this.#rollStatsMonth(guildID)
        await this.#runStats(
            countMonth
                ? "UPDATE guild_stats SET mailsSentTotal = mailsSentTotal + 1, mailsSentMonth = mailsSentMonth + 1 WHERE guildID = ?"
                : "UPDATE guild_stats SET mailsSentTotal = mailsSentTotal + 1 WHERE guildID = ?",
            [guildID]
        )
    }

    /**
     * Take one of the guild's free monthly emails, atomically: the check and the
     * increment are one conditional UPDATE, so concurrent sends on different shards
     * can't all pass on the same count and overshoot the limit. Give it back with
     * releaseFreeMail if the send then fails.
     * @returns {Promise<boolean>} false when the free quota is used up (or on a DB error)
     */
    async reserveFreeMail(guildID, freeLimit) {
        try {
            await this.#rollStatsMonth(guildID)
            const changes = await this.#runStats(
                "UPDATE guild_stats SET mailsSentMonth = mailsSentMonth + 1 WHERE guildID = ? AND statsMonth = ? AND mailsSentMonth < ?",
                [guildID, this.getCurrentMonth(), freeLimit]
            )
            return changes > 0
        } catch (err) {
            console.error('Error reserving free mail:', err)
            return false
        }
    }

    /** Give back a free email reserved for a send that failed (same month only). */
    releaseFreeMail(guildID) {
        return this.#runStats(
            "UPDATE guild_stats SET mailsSentMonth = mailsSentMonth - 1 WHERE guildID = ? AND statsMonth = ? AND mailsSentMonth > 0",
            [guildID, this.getCurrentMonth()]
        ).then(() => {}, (err) => {
            console.error('Error releasing free mail:', err)
        })
    }

    incrementVerifications(guildID) {
        this.#rollStatsMonth(guildID)
            .then(() => this.#runStats(
                "UPDATE guild_stats SET verificationsTotal = verificationsTotal + 1, verificationsMonth = verificationsMonth + 1 WHERE guildID = ?",
                [guildID]
            ))
            .catch(err => console.error('Error incrementing verifications:', err))
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

    /**
     * Histogram of remaining credits across guilds that have ever held credits.
     *
     * Only guilds present in `guild_premium` are counted: a server that never bought a
     * pack has no balance to run down, so including all ~2.4k installs would bury the
     * signal under a huge zero bucket. A guild sitting at 0 here HAS bought before and
     * is the strongest repurchase candidate, which is the point of the breakdown.
     *
     * The 1-10 boundary matches the `warnedCreditsLow` threshold used in
     * recordMailSentAndCheckThresholds(),
     * so "critical" here means the same thing it does in the admin warnings.
     */
    getCreditBuckets() {
        const empty = { b0: 0, b1_10: 0, b11_50: 0, b51_100: 0, b101_500: 0, b501_plus: 0 }
        return new Promise(resolve => {
            this.db.get(
                `SELECT
                    SUM(CASE WHEN bonusCredits <= 0 THEN 1 ELSE 0 END) AS b0,
                    SUM(CASE WHEN bonusCredits BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS b1_10,
                    SUM(CASE WHEN bonusCredits BETWEEN 11 AND 50 THEN 1 ELSE 0 END) AS b11_50,
                    SUM(CASE WHEN bonusCredits BETWEEN 51 AND 100 THEN 1 ELSE 0 END) AS b51_100,
                    SUM(CASE WHEN bonusCredits BETWEEN 101 AND 500 THEN 1 ELSE 0 END) AS b101_500,
                    SUM(CASE WHEN bonusCredits > 500 THEN 1 ELSE 0 END) AS b501_plus
                 FROM guild_premium`,
                (err, row) => {
                    if (err) {
                        console.error('Error getting credit buckets:', err)
                        resolve(empty)
                        return
                    }
                    // SUM() over zero rows yields NULL, not 0.
                    resolve({
                        b0: row?.b0 ?? 0,
                        b1_10: row?.b1_10 ?? 0,
                        b11_50: row?.b11_50 ?? 0,
                        b51_100: row?.b51_100 ?? 0,
                        b101_500: row?.b101_500 ?? 0,
                        b501_plus: row?.b501_plus ?? 0
                    })
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
     * @param {string} source - 'free' | 'credits' | 'credits-zepto' | 'vote' | 'subscription' | 'disabled'
     *   ('vote' only counts the send: the voter's own emails have no warnings)
     * @param {number} freeLimit
     */
    async recordMailSentAndCheckThresholds(guildID, source, freeLimit) {
        await this.#incrementMailsSentAwaitable(guildID, source !== 'free')

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
        await this.#rollStatsMonth(guildID)
        await this.#runStats("UPDATE guild_stats SET mailsDeniedMonth = mailsDeniedMonth + 1 WHERE guildID = ?", [guildID])

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
                    if (err) {
                        console.error('Error refunding guild credit:', err)
                        return resolve()
                    }
                    // A concurrent send may have tripped the zero warning on the way down;
                    // with credits back above 0 it must fire again at the next exhaustion,
                    // as after a top-up (addGuildCredits).
                    this.db.run(
                        "UPDATE guild_stats SET warnedCreditsZero = 0 WHERE guildID = ? AND (SELECT bonusCredits FROM guild_premium WHERE guildID = ?) > 0",
                        [guildID, guildID],
                        () => resolve()
                    )
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

    // ---------------------------------------------------------------------------
    // Consumable redemption ledger (see migration 28)
    // ---------------------------------------------------------------------------

    /**
     * Claim an entitlement for redemption before it is consumed on Discord. Succeeds
     * for a new entitlement, or for one whose earlier claim was left in 'consuming'
     * for longer than `staleMs` (the process died before consume() returned). A
     * concurrent /premium redeem of the same entitlement finds a fresh claim and backs off.
     *
     * @returns {Promise<?number>} the claim's createdAt when this caller owns it, else null
     */
    claimEntitlementRedemption({ entitlementID, guildID, userID, skuID, kind, amount }, staleMs) {
        const now = Date.now()
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO entitlement_redemptions (entitlementID, guildID, userID, skuID, kind, amount, status, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, 'consuming', ?)
                 ON CONFLICT(entitlementID) DO UPDATE SET
                     guildID = excluded.guildID, userID = excluded.userID, createdAt = excluded.createdAt
                 WHERE status = 'consuming' AND createdAt < ?`,
                [entitlementID, guildID, userID, skuID, kind, amount || 0, now, now - staleMs],
                function (err) {
                    if (err) return reject(err)
                    resolve(this.changes > 0 ? now : null)
                }
            )
        })
    }

    /**
     * Drop a claim whose entitlement was never consumed, so it can be redeemed again.
     * Only removes the claim made at `createdAt`, never one a later redeem took over.
     */
    releaseEntitlementRedemption(entitlementID, createdAt) {
        return new Promise((resolve) => {
            this.db.run(
                "DELETE FROM entitlement_redemptions WHERE entitlementID = ? AND status = 'consuming' AND createdAt = ?",
                [entitlementID, createdAt],
                function (err) {
                    if (err) console.error('Error releasing entitlement redemption:', err)
                    resolve(!err && this.changes > 0)
                }
            )
        })
    }

    /**
     * Apply a consumed entitlement to its guild and mark it granted, in one
     * transaction. Runs at most once per entitlement: a row already 'granted' (or
     * missing) resolves false and grants nothing.
     *
     * @returns {Promise<boolean>} whether this call granted it
     */
    grantEntitlementRedemption(entitlementID) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN IMMEDIATE", (beginErr) => {
                    if (beginErr) return reject(beginErr)
                    const fail = (err) => this.db.run("ROLLBACK", () => reject(err))

                    this.db.get(
                        "SELECT guildID, kind, amount FROM entitlement_redemptions WHERE entitlementID = ? AND status = 'consuming'",
                        [entitlementID],
                        (err, row) => {
                            if (err) return fail(err)
                            if (!row) return this.db.run("ROLLBACK", () => resolve(false))

                            const grantSql = row.kind === 'csv'
                                ? ["INSERT INTO guild_premium (guildID, csvUnlocked) VALUES (?, 1) ON CONFLICT(guildID) DO UPDATE SET csvUnlocked = 1", [row.guildID]]
                                : ["INSERT INTO guild_premium (guildID, bonusCredits) VALUES (?, ?) ON CONFLICT(guildID) DO UPDATE SET bonusCredits = bonusCredits + excluded.bonusCredits", [row.guildID, row.amount]]

                            this.db.run(grantSql[0], grantSql[1], (grantErr) => {
                                if (grantErr) return fail(grantErr)
                                this.db.run(
                                    "UPDATE entitlement_redemptions SET status = 'granted', grantedAt = ? WHERE entitlementID = ? AND status = 'consuming'",
                                    [Date.now(), entitlementID],
                                    (markErr) => {
                                        if (markErr) return fail(markErr)
                                        this.db.run("COMMIT", (commitErr) => {
                                            if (commitErr) return fail(commitErr)
                                            if (row.kind === 'credits') {
                                                // As after any top-up (addGuildCredits): warn again on the next exhaustion.
                                                this.db.run(
                                                    "UPDATE guild_stats SET warnedCreditsLow = 0, warnedCreditsZero = 0 WHERE guildID = ?",
                                                    [row.guildID],
                                                    () => resolve(true)
                                                )
                                            } else {
                                                resolve(true)
                                            }
                                        })
                                    }
                                )
                            })
                        }
                    )
                })
            })
        })
    }

    /** Claims still 'consuming' after `olderThanMs`: consumed-but-not-granted, or never consumed. */
    getStuckEntitlementRedemptions(olderThanMs) {
        return new Promise((resolve) => {
            this.db.all(
                "SELECT * FROM entitlement_redemptions WHERE status = 'consuming' AND createdAt < ?",
                [Date.now() - olderThanMs],
                (err, rows) => {
                    if (err) console.error('Error reading stuck entitlement redemptions:', err)
                    resolve(rows || [])
                }
            )
        })
    }

    // ---------------------------------------------------------------------------
    // Tier 2 restriction-list API
    // ---------------------------------------------------------------------------

    /**
     * Store (or replace) a guild's API token hash. Replacing revokes the previous
     * token, since a guild only ever has one.
     */
    setGuildApiToken(guildID, tokenHash, createdBy) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO guild_api_tokens (guildID, tokenHash, createdAt, createdBy, lastUsedAt)
                 VALUES (?, ?, ?, ?, NULL)
                 ON CONFLICT(guildID) DO UPDATE SET tokenHash = excluded.tokenHash,
                                                    createdAt = excluded.createdAt,
                                                    createdBy = excluded.createdBy,
                                                    lastUsedAt = NULL`,
                [guildID, tokenHash, Date.now(), createdBy || null],
                (err) => err ? reject(err) : resolve()
            )
        })
    }

    /** Resolve an incoming token hash to its guild. Returns null when unknown. */
    getGuildIdByApiTokenHash(tokenHash) {
        return new Promise((resolve) => {
            this.db.get("SELECT guildID FROM guild_api_tokens WHERE tokenHash = ?", [tokenHash], (err, row) => {
                if (err) {
                    console.error('Error looking up API token:', err)
                    return resolve(null)
                }
                resolve(row ? row.guildID : null)
            })
        })
    }

    /** Token metadata for `/api token status`. Never returns the hash itself. */
    getGuildApiTokenMeta(guildID) {
        return new Promise((resolve) => {
            this.db.get("SELECT createdAt, createdBy, lastUsedAt FROM guild_api_tokens WHERE guildID = ?", [guildID], (err, row) => {
                if (err || !row) return resolve(null)
                resolve({ createdAt: row.createdAt, createdBy: row.createdBy, lastUsedAt: row.lastUsedAt })
            })
        })
    }

    revokeGuildApiToken(guildID) {
        return new Promise((resolve) => {
            this.db.run("DELETE FROM guild_api_tokens WHERE guildID = ?", [guildID], function (err) {
                if (err) {
                    console.error('Error revoking API token:', err)
                    return resolve(false)
                }
                resolve(this.changes > 0)
            })
        })
    }

    /** Best-effort last-used stamp; a failure here must never fail the request. */
    touchGuildApiToken(guildID) {
        this.db.run("UPDATE guild_api_tokens SET lastUsedAt = ? WHERE guildID = ?", [Date.now(), guildID], () => {})
    }

    /**
     * Read-modify-write the guilds.allowedEmails column under BEGIN IMMEDIATE.
     *
     * updateServerSettings rewrites the whole row (INSERT OR REPLACE), so using it
     * from the API would clobber any setting an admin changed via a slash command
     * between our read and our write. These mutations touch one column, and the
     * immediate transaction serializes them against the other shards -- API requests
     * run on shard 0 while /emaillist can run on any shard, all against the same file.
     *
     * @param {(hashes: string[]) => {hashes: string[], result: Object}} mutate
     */
    #mutateAllowedEmails(guildID, mutate) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN IMMEDIATE", (beginErr) => {
                    if (beginErr) return reject(beginErr)

                    const fail = (err) => this.db.run("ROLLBACK", () => reject(err))

                    this.db.get("SELECT allowedEmails FROM guilds WHERE guildid = ?", [guildID], (err, row) => {
                        if (err) return fail(err)
                        if (row === undefined) {
                            // No settings row yet: the guild has never been configured, so
                            // there is no list to mutate and nothing sensible to create.
                            return this.db.run("ROLLBACK", () => resolve({ missing: true }))
                        }

                        let current = []
                        try {
                            current = row.allowedEmails ? JSON.parse(row.allowedEmails) : []
                        } catch {
                            current = []
                        }
                        if (!Array.isArray(current)) current = []

                        let next
                        try {
                            next = mutate(current)
                        } catch (e) {
                            return fail(e)
                        }

                        this.db.run(
                            "UPDATE guilds SET allowedEmails = ? WHERE guildid = ?",
                            [JSON.stringify(next.hashes), guildID],
                            (updErr) => {
                                if (updErr) return fail(updErr)
                                this.db.run("COMMIT", (commitErr) => {
                                    if (commitErr) return fail(commitErr)
                                    resolve(next.result)
                                })
                            }
                        )
                    })
                })
            })
        })
    }

    /** Add hashed addresses. Returns { added, skipped, total }. */
    addAllowedEmailHashes(guildID, hashes) {
        return this.#mutateAllowedEmails(guildID, (current) => {
            const set = new Set(current)
            let added = 0
            for (const h of hashes) {
                if (!set.has(h)) {
                    set.add(h)
                    added++
                }
            }
            const list = Array.from(set)
            return {
                hashes: list,
                result: { added, skipped: hashes.length - added, total: list.length }
            }
        })
    }

    /** Remove one hashed address. Returns { removed, total }. */
    removeAllowedEmailHash(guildID, hash) {
        return this.#mutateAllowedEmails(guildID, (current) => {
            const list = current.filter(h => h !== hash)
            return {
                hashes: list,
                result: { removed: current.length - list.length, total: list.length }
            }
        })
    }

    /** Empty the list. Returns { removed, total: 0 }. */
    clearAllowedEmails(guildID) {
        return this.#mutateAllowedEmails(guildID, (current) => ({
            hashes: [],
            result: { removed: current.length, total: 0 }
        }))
    }

    /**
     * Guild ids that still hold stale guild-scoped commands, out of those passed in.
     *
     * Asked as one query over the shard's own guilds rather than one per guild, so a
     * restart after the migration has completed costs a single read and no API calls.
     *
     * @param {string[]} guildIDs
     * @returns {Promise<Set<string>>}
     */
    async getGuildsNeedingCommandCleanup(guildIDs) {
        const pending = new Set(guildIDs)
        if (pending.size === 0) return pending

        // Chunked because every id is a bound parameter and SQLite caps those per
        // statement — a shard holding a few thousand guilds would otherwise fail the
        // query outright and, via the error path below, never clean up at all.
        const CHUNK = 500
        const ids = [...pending]
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK)
            const rows = await new Promise((resolve) => {
                this.db.all(
                    `SELECT guildID FROM guild_command_cleanup WHERE guildID IN (${chunk.map(() => '?').join(',')})`,
                    chunk,
                    (err, result) => {
                        if (err) {
                            console.warn('[DB] command-cleanup lookup failed:', err.message)
                            return resolve(null)
                        }
                        resolve(result || [])
                    }
                )
            })
            // On a read error, skip this chunk for this boot only — nothing is written to
            // guild_command_cleanup, so the next start retries it. Skipping rather than
            // assuming "all pending" avoids re-clearing every guild on every boot if the
            // table is ever unreadable, without permanently losing the cleanup.
            if (rows === null) {
                for (const id of chunk) pending.delete(id)
                continue
            }
            for (const row of rows) pending.delete(row.guildID)
        }
        return pending
    }

    /** Record that a guild's stale guild-scoped commands have been removed. */
    markGuildCommandsCleared(guildID) {
        return new Promise((resolve) => {
            this.db.run(
                "INSERT OR REPLACE INTO guild_command_cleanup (guildID, clearedAt) VALUES (?, ?)",
                [guildID, Date.now()],
                () => resolve()
            )
        })
    }

    /** Entry count without materializing the list for the caller. */
    getAllowedEmailCount(guildID) {
        return new Promise((resolve) => {
            this.db.get("SELECT allowedEmails FROM guilds WHERE guildid = ?", [guildID], (err, row) => {
                if (err || row === undefined) return resolve(null)
                try {
                    const parsed = row.allowedEmails ? JSON.parse(row.allowedEmails) : []
                    resolve(Array.isArray(parsed) ? parsed.length : 0)
                } catch {
                    resolve(0)
                }
            })
        })
    }

    /** Start tracking a freshly joined guild for setup follow-ups. */
    addGuildOnboarding(guildID, inviterID) {
        return new Promise((resolve) => {
            this.db.run(
                "INSERT OR REPLACE INTO guild_onboarding (guildID, joinedAt, inviterID, nudgesSent, lastNudgeAt) VALUES (?, ?, ?, 0, NULL)",
                [guildID, Date.now(), inviterID ?? null],
                (err) => {
                    if (err) console.error('Error adding guild onboarding:', err)
                    resolve()
                }
            )
        })
    }

    /** Every guild still awaiting a follow-up. Small by construction (new joins only). */
    getPendingOnboarding() {
        return new Promise((resolve) => {
            this.db.all("SELECT * FROM guild_onboarding", [], (err, rows) => {
                if (err) console.error('Error reading guild onboarding:', err)
                resolve(rows || [])
            })
        })
    }

    /**
     * Claim the next follow-up for a guild. Only succeeds while nudgesSent still equals
     * `expected`, so a restart or an overlapping check can never send the same nudge twice.
     *
     * @returns {Promise<boolean>} whether this caller owns the send
     */
    claimOnboardingNudge(guildID, expected) {
        return new Promise((resolve) => {
            this.db.run(
                "UPDATE guild_onboarding SET nudgesSent = nudgesSent + 1, lastNudgeAt = ? WHERE guildID = ? AND nudgesSent = ?",
                [Date.now(), guildID, expected],
                function (err) {
                    if (err) {
                        console.error('Error claiming onboarding nudge:', err)
                        return resolve(false)
                    }
                    resolve(this.changes > 0)
                }
            )
        })
    }

    deleteGuildOnboarding(guildID) {
        return new Promise((resolve) => {
            this.db.run("DELETE FROM guild_onboarding WHERE guildID = ?", [guildID], () => resolve())
        })
    }

    /** Remember the server a user's future votes should reward. */
    setVoteTarget(userID, guildID) {
        return new Promise((resolve) => {
            this.db.run(
                "INSERT INTO vote_targets (userID, guildID, updatedAt) VALUES (?, ?, ?) ON CONFLICT(userID) DO UPDATE SET guildID = excluded.guildID, updatedAt = excluded.updatedAt",
                [userID, guildID, Date.now()],
                (err) => {
                    if (err) console.error('Error setting vote target:', err)
                    resolve()
                }
            )
        })
    }

    /** @returns {Promise<?string>} the guild id, or null when the user never picked one */
    getVoteTarget(userID) {
        return new Promise((resolve) => {
            this.db.get("SELECT guildID FROM vote_targets WHERE userID = ?", [userID], (err, row) => {
                if (err) console.error('Error reading vote target:', err)
                resolve(row?.guildID ?? null)
            })
        })
    }

    /**
     * The verification emails a user's votes have unlocked for them in one guild this
     * month, and how many of those they have already used.
     *
     * @returns {Promise<{earned: number, used: number}>}
     */
    getVotePass(userID, guildID) {
        return new Promise((resolve) => {
            this.db.get(
                "SELECT COALESCE(SUM(bonusGranted), 0) AS earned, COALESCE(SUM(mailsUsed), 0) AS used FROM votes WHERE userID = ? AND guildID = ? AND month = ?",
                [userID, guildID, this.getCurrentMonth()],
                (err, row) => {
                    if (err) console.error('Error reading vote pass:', err)
                    resolve({ earned: row?.earned ?? 0, used: row?.used ?? 0 })
                }
            )
        })
    }

    /**
     * Spend one of the emails a user's votes unlocked in this guild this month. A single
     * UPDATE, so two sends at once can't both take the last one.
     *
     * @returns {Promise<?number>} the id of the votes row it was taken from (hand it to
     *   refundVotePass), or null when the user has none left
     */
    consumeVotePass(userID, guildID) {
        return new Promise((resolve) => {
            this.db.get(
                `UPDATE votes SET mailsUsed = mailsUsed + 1 WHERE id = (
                     SELECT id FROM votes WHERE userID = ? AND guildID = ? AND month = ? AND mailsUsed < bonusGranted
                     ORDER BY id LIMIT 1
                 ) RETURNING id`,
                [userID, guildID, this.getCurrentMonth()],
                (err, row) => {
                    if (err) {
                        console.error('Error consuming vote pass:', err)
                        resolve(null)
                        return
                    }
                    resolve(row ? row.id : null)
                }
            )
        })
    }

    /**
     * Give back a vote email whose send failed, like refundGuildCredit does for credits.
     * With `voteId` (from consumeVotePass) the email goes back to the row it came from,
     * even when the month rolled over in between; without it, to the newest used row
     * of the current month.
     */
    refundVotePass(userID, guildID, voteId = null) {
        const [sql, params] = voteId
            ? ["UPDATE votes SET mailsUsed = mailsUsed - 1 WHERE id = ? AND userID = ? AND mailsUsed > 0", [voteId, userID]]
            : [`UPDATE votes SET mailsUsed = mailsUsed - 1 WHERE id = (
                     SELECT id FROM votes WHERE userID = ? AND guildID = ? AND month = ? AND mailsUsed > 0
                     ORDER BY id DESC LIMIT 1
                 )`, [userID, guildID, this.getCurrentMonth()]]
        return new Promise((resolve) => {
            this.db.run(sql, params, (err) => {
                if (err) console.error('Error refunding vote pass:', err)
                resolve()
            })
        })
    }

    /**
     * Log one vote and unlock its emails for the voter in `guildID`, capped per voter
     * per guild per month.
     *
     * Dedupe and cap are enforced inside a single INSERT ... SELECT, so a webhook retry
     * or two votes landing at once can neither double-grant nor overshoot the cap. A
     * vote from the same user on the same list inside `dedupeWindowMs` is a retry (both
     * lists allow one vote per 12 hours) and is dropped.
     *
     * @returns {Promise<{duplicate: boolean, bonusGranted: number, monthTotal: ?number, remaining: ?number}>}
     */
    recordVote({ source, userID, guildID, perVote, monthlyCap, dedupeWindowMs }) {
        const now = Date.now()
        const month = this.getCurrentMonth()
        const db = this.db
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO votes (source, userID, guildID, month, votedAt, bonusGranted)
                 SELECT $source, $userID, $guildID, $month, $now,
                        CASE WHEN $guildID IS NULL THEN 0
                             ELSE MAX(0, MIN($perVote, $cap - COALESCE(
                                 (SELECT SUM(bonusGranted) FROM votes WHERE userID = $userID AND guildID = $guildID AND month = $month), 0)))
                        END
                 WHERE NOT EXISTS (
                     SELECT 1 FROM votes WHERE source = $source AND userID = $userID AND votedAt > $since
                 )`,
                {
                    $source: source, $userID: userID, $guildID: guildID ?? null, $month: month,
                    $now: now, $perVote: perVote, $cap: monthlyCap, $since: now - dedupeWindowMs
                },
                function (err) {
                    if (err) return reject(err)
                    if (this.changes === 0) return resolve({ duplicate: true, bonusGranted: 0, monthTotal: null, remaining: null })
                    const voteId = this.lastID
                    db.get("SELECT bonusGranted FROM votes WHERE id = ?", [voteId], (e1, row) => {
                        if (e1) return reject(e1)
                        const bonusGranted = row?.bonusGranted ?? 0
                        if (!guildID) return resolve({ duplicate: false, bonusGranted, monthTotal: null, remaining: null })
                        db.get(
                            "SELECT COALESCE(SUM(bonusGranted), 0) AS earned, COALESCE(SUM(mailsUsed), 0) AS used FROM votes WHERE userID = ? AND guildID = ? AND month = ?",
                            [userID, guildID, month],
                            (e2, sum) => {
                                if (e2) return reject(e2)
                                const earned = sum?.earned ?? 0
                                resolve({ duplicate: false, bonusGranted, monthTotal: earned, remaining: Math.max(0, earned - (sum?.used ?? 0)) })
                            }
                        )
                    })
                }
            )
        })
    }
}

const database = new Database()

module.exports = database


