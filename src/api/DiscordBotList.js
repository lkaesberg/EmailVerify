// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Keeps the slash-command list on the discordbotlist.com page current; the list shows
// none unless the bot sends it. (Its server count is posted by BotListStats.js.)
//
// Best-effort: a listing outage must never touch the bot itself, so a failure is logged
// in one line and swallowed. Without a token (self-hosted installs, dev) nothing is sent.

const { discordbotlistToken, clientId } = require('../../config/config.json')
const analytics = require('../utils/Analytics')

const REQUEST_TIMEOUT_MS = 15 * 1000

/**
 * Publish the command list shown on the bot's page. Takes the exact array sent to
 * Discord, which is the format the list accepts. Unlike the stats endpoint, this one
 * wants the token with a `Bot ` prefix.
 *
 * @returns {Promise<boolean>} whether the list accepted it; never rejects
 */
async function postCommands(commands, botId = clientId) {
    if (!discordbotlistToken) return false
    let status = null
    const report = (ok, error = null) => analytics.capture({
        event: 'bot_list_commands_posted',
        properties: { list: 'discordbotlist', ok, http_status: status, error, commands: commands.length }
    })
    try {
        const res = await fetch(`https://discordbotlist.com/api/v1/bots/${botId}/commands`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${discordbotlistToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(commands),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        status = res.status
        if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
        }
        console.log(`Posted ${commands.length} commands to discordbotlist`)
        report(true)
        return true
    } catch (e) {
        console.warn('[discordbotlist] posting commands failed:', e?.message || e)
        report(false, String(e?.message || e).slice(0, 300))
        return false
    }
}

module.exports = { postCommands }
