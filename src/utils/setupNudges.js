// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Setup follow-ups: up to two DMs to whoever added the bot, when their server still
// hasn't verified anyone a day and three days later.
//
// Why: 50-68 percent of every weekly cohort of new servers never completes a single
// verification. The welcome message on join says what to do, but an admin who got
// distracted never comes back to it. Each nudge names the one thing still missing.
//
// Only servers the bot joins from now on are tracked (see guild_onboarding), so the
// servers that were already in can never be messaged. Each shard handles only the
// guilds it holds, and a nudge is claimed in the database before it is sent, so no
// restart or overlap can send it twice.

const Discord = require('discord.js')
const config = require('../../config/config.json')
const database = require('../database/Database')
const { getLocale, defaultLanguage } = require('../Language')
const analytics = require('./Analytics')
const { getSupportUrl, websiteLink } = require('./premiumButtons')

const DEFAULT_DELAYS_HOURS = [24, 72]
const HOUR_MS = 60 * 60 * 1000
const FIRST_CHECK_MS = 5 * 60 * 1000
const CHECK_INTERVAL_MS = HOUR_MS
// A row whose guild no shard holds any more (the bot left while offline, so guildDelete
// never ran) is dropped once it is well past the last nudge.
const STALE_AFTER_MS = 7 * 24 * HOUR_MS

/** Hours after joining at which each nudge is due; config.onboarding.nudgeDelaysHours. */
function nudgeDelaysMs() {
    const configured = config.onboarding?.nudgeDelaysHours
    const hours = Array.isArray(configured) && configured.length > 0 && configured.every(h => typeof h === 'number' && h > 0)
        ? configured
        : DEFAULT_DELAYS_HOURS
    return hours.map(h => h * HOUR_MS)
}

function getSettings(guildId) {
    return new Promise(resolve => database.getServerSettings(guildId, resolve))
}

function getStats(guildId) {
    return new Promise(resolve => database.getGuildStats(guildId, resolve))
}

/**
 * What still stands between the server and its first verification, or null once
 * someone has verified.
 *
 * @returns {Promise<?('no_roles'|'no_verifications')>}
 */
async function setupGap(guild) {
    const stats = await getStats(guild.id)
    if (stats.verificationsTotal > 0) return null
    const settings = await getSettings(guild.id)
    const roles = (settings.defaultRoles || []).filter(id => guild.roles.cache.has(id))
    return roles.length === 0 ? 'no_roles' : 'no_verifications'
}

function buildNudge(guild, gap, language, isLast) {
    let description = getLocale(language, gap === 'no_roles' ? 'nudgeNoRoles' : 'nudgeNoVerifications', guild.name)
    if (isLast) description += '\n\n' + getLocale(language, 'nudgeLast')

    const embed = new Discord.EmbedBuilder()
        .setTitle(getLocale(language, 'nudgeTitle', guild.name))
        .setDescription(description)
        .setColor(0x5865F2)

    const buttons = []
    const guide = websiteLink('setup/', 'nudge')
    if (guide) {
        buttons.push(new Discord.ButtonBuilder()
            .setStyle(Discord.ButtonStyle.Link).setLabel(getLocale(language, 'nudgeGuideButton')).setURL(guide))
    }
    const support = getSupportUrl()
    if (support) {
        buttons.push(new Discord.ButtonBuilder()
            .setStyle(Discord.ButtonStyle.Link).setLabel(getLocale(language, 'nudgeSupportButton')).setURL(support))
    }
    const components = buttons.length ? [new Discord.ActionRowBuilder().addComponents(buttons)] : []
    return { embeds: [embed], components }
}

/**
 * DM the admin who added the bot, else the owner. Both are tried in turn because DMs are
 * routinely closed; failing both is an expected outcome, not an error.
 *
 * @returns {Promise<boolean>} whether a DM went out
 */
async function deliver(client, guild, inviterId, message) {
    const candidates = []
    if (inviterId) candidates.push(inviterId)
    if (guild.ownerId && guild.ownerId !== inviterId) candidates.push(guild.ownerId)

    for (const userId of candidates) {
        try {
            const user = await client.users.fetch(userId)
            if (user.bot) continue
            await user.send(message)
            return true
        } catch {
            // DMs closed or user gone: try the next candidate.
        }
    }
    return false
}

async function checkGuild(client, row, delays, now) {
    const guild = client.guilds.cache.get(row.guildID)
    if (!guild) {
        // Either another shard holds it, or the bot left while offline.
        if (now - row.joinedAt > delays[delays.length - 1] + STALE_AFTER_MS) {
            await database.deleteGuildOnboarding(row.guildID)
        }
        return
    }

    const gap = await setupGap(guild)
    if (!gap) {
        await database.deleteGuildOnboarding(row.guildID)
        return
    }

    const index = row.nudgesSent
    if (index >= delays.length) {
        await database.deleteGuildOnboarding(row.guildID)
        return
    }
    if (now - row.joinedAt < delays[index]) return
    if (!(await database.claimOnboardingNudge(row.guildID, index))) return

    const settings = await getSettings(guild.id)
    const language = settings.language || defaultLanguage
    const isLast = index === delays.length - 1
    const dmSent = await deliver(client, guild, row.inviterID, buildNudge(guild, gap, language, isLast))

    analytics.capture({
        event: 'onboarding_nudge_sent',
        guild,
        properties: {
            nudge: index + 1,
            reason: gap,
            dm_sent: dmSent,
            hours_since_join: Math.round((now - row.joinedAt) / HOUR_MS),
            language
        }
    })

    if (isLast) await database.deleteGuildOnboarding(row.guildID)
}

async function runChecks(client) {
    const rows = await database.getPendingOnboarding()
    if (rows.length === 0) return
    const delays = nudgeDelaysMs()
    const now = Date.now()
    for (const row of rows) {
        try {
            await checkGuild(client, row, delays, now)
        } catch (e) {
            console.warn(`[SetupNudges] check failed for ${row.guildID}:`, e?.message || e)
        }
    }
}

/** Start the hourly check on this shard. Each shard nudges only the guilds it holds. */
function startSetupNudges(client) {
    setTimeout(() => runChecks(client).catch(() => {}), FIRST_CHECK_MS).unref()
    setInterval(() => runChecks(client).catch(() => {}), CHECK_INTERVAL_MS).unref()
}

module.exports = { startSetupNudges, runChecks, setupGap, buildNudge, nudgeDelaysMs }
