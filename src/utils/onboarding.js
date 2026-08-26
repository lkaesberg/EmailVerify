// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// First-run onboarding: what a server sees the moment the bot is added.
//
// Why this exists: of 116 servers that joined in a 60-day window, 41 removed the bot
// again and 27 of those within the first hour — 24 of the 27 without ever completing a
// single verification. The bot does nothing at all until an admin configures roles,
// domains and a channel, so an admin who adds it and sees silence reasonably concludes
// it is broken. This closes that gap by saying, immediately and in the right place,
// what the bot does and the three steps that make it work.

const Discord = require('discord.js')
const { getLocale } = require('../Language')
const { getWebsiteUrl } = require('./premiumButtons')

/**
 * The user who actually added the bot, or null.
 *
 * Reading this needs the View Audit Log permission, which plenty of servers never grant,
 * and the entry only exists for a short while. Both are ordinary outcomes rather than
 * errors — callers fall back to the guild owner.
 */
async function resolveInviter(guild) {
    const me = guild.members.me
    if (!me?.permissions?.has(Discord.PermissionsBitField.Flags.ViewAuditLog)) return null
    try {
        const logs = await guild.fetchAuditLogs({ type: Discord.AuditLogEvent.BotAdd, limit: 5 })
        const entry = logs.entries.find(e => e.target?.id === guild.client.user.id)
        return entry?.executor ?? null
    } catch {
        return null
    }
}

/**
 * Best channel to greet the server in: the configured system channel when the bot can
 * post there, otherwise the highest text channel it can actually write to. Returns null
 * when the bot cannot post anywhere, which is normal on locked-down servers.
 */
function pickWelcomeChannel(guild) {
    const me = guild.members.me
    if (!me) return null

    const canPost = channel => {
        if (!channel?.isTextBased?.()) return false
        const perms = channel.permissionsFor(me)
        return !!perms?.has([
            Discord.PermissionsBitField.Flags.ViewChannel,
            Discord.PermissionsBitField.Flags.SendMessages,
            Discord.PermissionsBitField.Flags.EmbedLinks
        ])
    }

    if (canPost(guild.systemChannel)) return guild.systemChannel

    return guild.channels.cache
        .filter(channel => channel.type === Discord.ChannelType.GuildText && canPost(channel))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first() ?? null
}

/**
 * @param {string} language
 * @param {?string} guildName set for the DM copy, which needs to name the server since
 *                            the reader may administer several
 */
function buildOnboardingEmbed(language, guildName = null) {
    const websiteUrl = getWebsiteUrl()

    const parts = []
    if (guildName) parts.push(getLocale(language, 'onboardingDmIntro', guildName))
    parts.push(getLocale(language, 'onboardingWhat'))
    parts.push(getLocale(language, 'onboardingSteps'))
    if (websiteUrl) parts.push(getLocale(language, 'onboardingHelp', websiteUrl))

    return new Discord.EmbedBuilder()
        .setTitle(getLocale(language, 'onboardingTitle'))
        .setDescription(parts.join('\n\n'))
        .setColor(0x5865F2)
}

/**
 * Greet a freshly joined guild in a channel and DM whoever added the bot.
 *
 * Both deliveries are attempted because each fails routinely and for different reasons:
 * the channel post fails on servers that grant no posting permission, the DM fails when
 * the admin has DMs closed. Neither failure is worth surfacing to the server, so every
 * send is swallowed; the returned flags exist so the caller can measure delivery.
 *
 * @returns {Promise<{channelSent: boolean, dmSent: boolean, inviterResolved: boolean}>}
 */
async function sendOnboarding(guild, language = 'english') {
    let channelSent = false
    let dmSent = false

    const channel = pickWelcomeChannel(guild)
    if (channel) {
        try {
            await channel.send({ embeds: [buildOnboardingEmbed(language)] })
            channelSent = true
        } catch (e) {
            console.warn(`[Onboarding] could not post in ${guild.id}:`, e?.message || e)
        }
    }

    const inviter = await resolveInviter(guild)
    let recipient = inviter
    if (!recipient) {
        try {
            recipient = (await guild.fetchOwner()).user
        } catch {
            recipient = null
        }
    }

    if (recipient && !recipient.bot) {
        try {
            await recipient.send({ embeds: [buildOnboardingEmbed(language, guild.name)] })
            dmSent = true
        } catch {
            // DMs closed, or the bot shares no mutual context — expected, not an error.
        }
    }

    return { channelSent, dmSent, inviterResolved: !!inviter }
}

module.exports = {
    sendOnboarding,
    pickWelcomeChannel,
    resolveInviter,
    buildOnboardingEmbed
}
