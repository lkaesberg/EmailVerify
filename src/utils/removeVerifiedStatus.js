// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const database = require('../database/Database')

// getServerSettings never calls back on a read error; don't let that stall the other guilds.
const SETTINGS_TIMEOUT_MS = 10 * 1000

function readServerSettings(guildId) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), SETTINGS_TIMEOUT_MS)
        database.getServerSettings(guildId, serverSettings => {
            clearTimeout(timer)
            resolve(serverSettings)
        })
    })
}

/**
 * Strip a member's verification roles in one guild (every default and domain role,
 * since we don't know which domain they verified with) and re-apply the unverified role.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @returns {Promise<boolean>} false when they are not a member there or the settings could not be read
 */
async function removeVerifiedStatus(guild, userId) {
    const serverSettings = await readServerSettings(guild.id)
    if (!serverSettings) return false
    const member = await guild.members.fetch(userId).catch(() => null)
    if (!member) return false

    const domainRoles = serverSettings.domainRoles || {}
    const roleIds = new Set([...(serverSettings.defaultRoles || []), ...Object.values(domainRoles).flat()])
    for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId)
        if (role) {
            await member.roles.remove(role).catch(() => {})
        }
    }

    const roleUnverified = guild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName)
    if (roleUnverified !== undefined) {
        await member.roles.add(roleUnverified).catch(() => {})
    }
    return true
}

/**
 * removeVerifiedStatus in each of these guilds that this client (shard) holds;
 * guilds on other shards are skipped. Exposed on the client for broadcastEval.
 *
 * @param {import('discord.js').Client} client
 * @param {string[]} guildIds
 * @param {string} userId
 * @returns {Promise<number>} guilds handled on this shard
 */
async function removeVerifiedStatusOnShard(client, guildIds, userId) {
    let handled = 0
    for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId)
        if (!guild) continue
        try {
            await removeVerifiedStatus(guild, userId)
        } catch (e) {
            console.error(`Error removing verified status in guild ${guildId}:`, e)
        }
        handled++
    }
    return handled
}

/**
 * Remove a user's verified status in every listed guild, whichever shard holds it.
 * /data delete-user deletes the user's rows in every guild; without this their roles
 * stayed in the other guilds, so a second account could verify there with the same
 * mailbox (the previous-holder check finds no row) and both kept their roles.
 *
 * @param {import('discord.js').Client} client
 * @param {string[]} guildIds
 * @param {string} userId
 */
async function removeVerifiedStatusEverywhere(client, guildIds, userId) {
    if (guildIds.length === 0) return
    if (client.shard) {
        // broadcastEval serialises the function into each shard, so it reaches the
        // helper through the shard's own client (set in EmailBot.js).
        await client.shard.broadcastEval(
            (c, { guildIds, userId }) => (c.removeVerifiedStatusOnShard ? c.removeVerifiedStatusOnShard(guildIds, userId) : 0),
            { context: { guildIds, userId } }
        )
        return
    }
    await removeVerifiedStatusOnShard(client, guildIds, userId)
}

module.exports = { removeVerifiedStatus, removeVerifiedStatusOnShard, removeVerifiedStatusEverywhere }
