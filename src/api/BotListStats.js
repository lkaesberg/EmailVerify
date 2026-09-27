// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Server-count posting for the bot lists (top.gg has its own autoposter, see TopGG.js).
// Counts once per round and posts the same total to every list with a token set.
//
// Every list gets one total and no shard id, so there is no question of how a list
// combines per-shard reports. Best-effort throughout: a list outage is logged in one
// line and never touches the bot.

const { ShardingManager } = require('discord.js')
const config = require('../../config/config.json')
const analytics = require('../utils/Analytics')

const REQUEST_TIMEOUT_MS = 15 * 1000
const FIRST_POST_MS = 60 * 1000
const INTERVAL_MS = 30 * 60 * 1000

const LISTS = [
    {
        name: 'discordbotlist',
        token: config.discordbotlistToken,
        url: id => `https://discordbotlist.com/api/v1/bots/${id}/stats`,
        body: ({ guilds, users }) => ({ guilds, users, voice_connections: 0 })
    },
    {
        // Rate limit 1 request / 5 s, far below one post per half hour.
        name: 'discord.bots.gg',
        token: config.discordbotsggToken,
        url: id => `https://discord.bots.gg/api/v1/bots/${id}/stats`,
        body: ({ guilds }) => ({ guildCount: guilds })
    }
]

const loggedFirst = new Set()

// One event per list per round, so PostHog shows whether each listing is being kept
// current without anyone reading the production logs.
function report(list, { ok, status = null, error = null, servers = null }) {
    analytics.capture({
        event: 'bot_list_stats_posted',
        properties: { list: list.name, ok, http_status: status, error, servers }
    })
}

async function countStats(source) {
    const memberSum = client => client.guilds.cache.reduce((n, g) => n + (g.memberCount || 0), 0)
    if (source instanceof ShardingManager) {
        // broadcastEval serialises the function into each shard, so it cannot close
        // over memberSum and has to spell the sum out.
        const [guilds, users] = await Promise.all([
            source.fetchClientValues('guilds.cache.size'),
            source.broadcastEval(client => client.guilds.cache.reduce((n, g) => n + (g.memberCount || 0), 0))
        ])
        const sum = values => values.reduce((a, b) => a + b, 0)
        return { guilds: sum(guilds), users: sum(users) }
    }
    return { guilds: source.guilds.cache.size, users: memberSum(source) }
}

/**
 * Post one reading to one list. Both lists take the token as-is in `Authorization`,
 * with no `Bot ` prefix.
 *
 * @returns {Promise<boolean>} whether the list accepted it; never rejects
 */
async function postToList(list, counts, botId = config.clientId) {
    let status = null
    try {
        const res = await fetch(list.url(botId), {
            method: 'POST',
            headers: { 'Authorization': list.token, 'Content-Type': 'application/json' },
            body: JSON.stringify(list.body(counts)),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        status = res.status
        if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
        }
        if (!loggedFirst.has(list.name)) {
            console.log(`Posted stats to ${list.name} (${counts.guilds} servers)`)
            loggedFirst.add(list.name)
        }
        report(list, { ok: true, status, servers: counts.guilds })
        return true
    } catch (e) {
        console.warn(`[${list.name}] posting stats failed:`, e?.message || e)
        report(list, { ok: false, status, error: String(e?.message || e).slice(0, 300), servers: counts.guilds })
        return false
    }
}

/**
 * One round: count once, post to every configured list.
 *
 * @param {ShardingManager|Client} source
 * @returns {Promise<Object<string, boolean>>} per-list success; never rejects
 */
async function postStats(source, lists = LISTS.filter(list => list.token), botId = config.clientId) {
    let counts
    try {
        counts = await countStats(source)
    } catch (e) {
        console.warn('[BotLists] counting servers failed:', e?.message || e)
        const error = `counting servers failed: ${String(e?.message || e).slice(0, 250)}`
        for (const list of lists) report(list, { ok: false, error })
        return {}
    }
    const results = await Promise.all(lists.map(list => postToList(list, counts, botId)))
    return Object.fromEntries(lists.map((list, i) => [list.name, results[i]]))
}

/**
 * Keep the server count current on every list with a token: the ShardingManager in
 * production, or the Client when running unsharded. First post after a minute so
 * every shard has its guilds loaded, then every 30 minutes, the same cadence as the
 * top.gg autoposter.
 */
function startBotListStats(source) {
    const lists = LISTS.filter(list => list.token)
    for (const list of LISTS) {
        if (!list.token) console.log(`No ${list.name} token!`)
    }
    if (lists.length === 0) return
    setTimeout(() => postStats(source, lists), FIRST_POST_MS).unref()
    setInterval(() => postStats(source, lists), INTERVAL_MS).unref()
    console.log(`Posting stats to ${lists.map(list => list.name).join(', ')}!`)
}

module.exports = { LISTS, countStats, postStats, startBotListStats }
