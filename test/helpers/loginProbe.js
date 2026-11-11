// SPDX-License-Identifier: AGPL-3.0-or-later
// Preloaded into a child process running src/EmailBot.js (after env.js): replaces
// Client#login so the bot never connects anywhere, and reports the schema version a
// separate connection sees at the moment login is called.

const sqlite3 = require('sqlite3')
const { Client } = require('discord.js')

Client.prototype.login = function () {
    const conn = new sqlite3.Database('config/bot.db')
    conn.get('PRAGMA user_version', (err, row) => {
        process.stdout.write(JSON.stringify({ loginAtUserVersion: err ? null : row.user_version, error: err?.message }) + '\n')
        conn.close(() => process.exit(0))
    })
    return new Promise(() => {})
}
