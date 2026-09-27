// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Vote rewards: a vote on top.gg or discordbotlist.com gives one server extra free
// verification emails for the current month, capped per month.
//
// Votes arrive from the lists as webhooks carrying only the voter's user id, so the
// server to reward is the one the voter last ran /vote (or pressed a vote button) in.
// top.gg can also carry it in the vote URL's query string, which wins when present.
//
// The prompts are placed where a vote is most wanted: when a server runs out of free
// emails, the member who can't get in is one click away from fixing it themselves.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, Routes } = require('discord.js')
const config = require('../../config/config.json')
const database = require('../database/Database')
const premiumManager = require('../premium/PremiumManager')
const { getLocale, defaultLanguage } = require('../Language')
const analytics = require('./Analytics')
const rest = require('../api/DiscordRest')
const { createMailLimitReachedEmbed } = require('./embeds')
const { getWebsiteUrl } = require('./premiumButtons')

// Both lists allow one vote per user every 12 hours. Anything from the same user on the
// same list inside 11 hours is a webhook retry, not a new vote.
const DEDUPE_WINDOW_MS = 11 * 60 * 60 * 1000

const SNOWFLAKE = /^\d{17,20}$/

const SOURCES = {
    topgg: {
        name: 'top.gg',
        secret: config.topggWebhookSecret,
        voteUrl: guildId => `https://top.gg/bot/${config.clientId}/vote` + (guildId ? `?guild=${guildId}` : '')
    },
    discordbotlist: {
        name: 'discordbotlist.com',
        secret: config.discordbotlistWebhookSecret,
        voteUrl: () => `https://discordbotlist.com/bots/${config.clientId}/upvote`
    }
}

/** Lists with a webhook secret configured — a list without one can't deliver rewards. */
function activeSources() {
    return Object.keys(SOURCES).filter(key => SOURCES[key].secret)
}

/**
 * Whether vote rewards exist on this bot at all. Off for self-hosted installs (no
 * quota to raise, and no listing of their own) and until a webhook secret is set.
 */
function isEnabled() {
    return premiumManager.enabled && activeSources().length > 0
}

async function getVoteStatus(guildId) {
    const { perVote, monthlyCap } = premiumManager.voteReward
    const bonus = await database.getVoteBonus(guildId)
    return { bonus, perVote, cap: monthlyCap, capped: bonus >= monthlyCap }
}

/** "Vote for +5 free emails" button; opens the vote prompt for `guildId`. */
function voteButtonRow(language, guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`vote:${guildId}`)
            .setLabel(getLocale(language, 'voteButtonLabel', String(premiumManager.voteReward.perVote)))
            .setEmoji('🗳️')
            .setStyle(ButtonStyle.Primary)
    )
}

function voteLinkRow(language, guildId) {
    return new ActionRowBuilder().addComponents(
        activeSources().map(key => new ButtonBuilder()
            .setLabel(getLocale(language, 'voteLinkLabel', SOURCES[key].name))
            .setURL(SOURCES[key].voteUrl(guildId))
            .setStyle(ButtonStyle.Link))
    )
}

/**
 * The guild the bot is actually in, fetched over REST. Webhooks land on shard 0, which
 * only caches its own guilds, and a raw REST read (unlike client.guilds.fetch) doesn't
 * pull another shard's guild into this shard's cache and skew its counts.
 */
async function fetchGuild(guildId) {
    if (!guildId || !SNOWFLAKE.test(String(guildId))) return null
    try {
        return await rest.get(Routes.guild(guildId))
    } catch {
        return null
    }
}

function getLanguage(guildId) {
    if (!guildId) return Promise.resolve(defaultLanguage)
    return new Promise(resolve => database.getServerSettings(guildId, s => resolve(s?.language || defaultLanguage)))
}

/**
 * Answer /vote or a vote button: remember this server as the voter's target and show
 * the vote links with how much of this month's bonus is left.
 */
async function showVotePrompt(interaction, guildId, entry) {
    const language = await getLanguage(guildId)
    if (!isEnabled() || !guildId) {
        await interaction.reply({ content: getLocale(language, 'voteNotAvailable'), flags: MessageFlags.Ephemeral }).catch(() => {})
        return
    }

    // A button can be pressed in a DM (quota warnings go to the owner), where the guild
    // isn't at hand; the command always runs inside the server.
    const guildName = interaction.guild?.id === guildId
        ? interaction.guild.name
        : (interaction.client.guilds.cache.get(guildId)?.name ?? (await fetchGuild(guildId))?.name ?? '')

    await database.setVoteTarget(interaction.user.id, guildId)
    const status = await getVoteStatus(guildId)

    const description = status.capped
        ? getLocale(language, 'voteCommandCapped', guildName, String(status.cap))
        : getLocale(language, 'voteCommandDescription', guildName, String(status.perVote), String(status.cap), String(status.bonus), String(status.cap))

    const embed = new EmbedBuilder()
        .setTitle(getLocale(language, 'voteCommandTitle'))
        .setDescription(description + '\n\n' + getLocale(language, 'voteCommandTargetNote'))
        .setColor(0x5865F2)

    analytics.capture({
        event: 'vote_prompt_shown',
        userId: interaction.user.id,
        guildId,
        guild: interaction.guild?.id === guildId ? interaction.guild : null,
        properties: { entry, capped: status.capped, bonus_month_total: status.bonus }
    })

    await interaction.reply({
        embeds: [embed],
        components: [voteLinkRow(language, guildId)],
        flags: MessageFlags.Ephemeral
    }).catch(() => {})
}

/**
 * The "this server is out of free emails" message a member sees, plus a vote button
 * while this month's bonus isn't used up.
 */
async function limitReachedMessage(language, guildId) {
    const embed = createMailLimitReachedEmbed(language, getWebsiteUrl())
    const payload = { embeds: [embed] }
    if (!isEnabled() || !guildId) return payload
    try {
        const status = await getVoteStatus(guildId)
        if (status.capped) return payload
        embed.setDescription(embed.data.description + '\n\n' + getLocale(language, 'voteLimitHint', String(status.perVote)))
        payload.components = [voteButtonRow(language, guildId)]
    } catch {
        // The limit notice matters more than the vote offer — send it without.
    }
    return payload
}

/**
 * For admin quota warnings: the free way to get more emails and a button for it, or
 * null when voting is off or this month's bonus is spent.
 *
 * @returns {Promise<?{line: string, row: ActionRowBuilder}>}
 */
async function quotaWarningExtras(language, guildId) {
    if (!isEnabled() || !guildId) return null
    try {
        const status = await getVoteStatus(guildId)
        if (status.capped) return null
        return {
            line: getLocale(language, 'voteQuotaHint', String(status.perVote), String(status.cap)),
            row: voteButtonRow(language, guildId)
        }
    } catch {
        return null
    }
}

/** "Vote bonus this month: +10 / +25" for /premium and /status, or null. */
function bonusStatusLine(language, premiumStatus) {
    if (!isEnabled() || premiumStatus.subscriptionTier || premiumStatus.mailMode === 'zeptomail') return null
    return getLocale(language, 'premiumVoteBonusLine', String(premiumStatus.voteBonus ?? 0), String(premiumStatus.voteBonusCap ?? 0))
}

/**
 * Credit one incoming vote. Resolves once the vote is recorded; the thank-you DM is
 * sent in the background so the webhook can answer the list quickly.
 *
 * @param {{source: 'topgg'|'discordbotlist', userId: string, queryGuildId?: string, client: import('discord.js').Client}} vote
 */
async function processVote({ source, userId, queryGuildId, client }) {
    // The vote URL's own guild wins over the stored target; either only counts while
    // the bot is still in that server.
    let guild = await fetchGuild(queryGuildId)
    let attributedVia = guild ? 'query' : null
    if (!guild) {
        guild = await fetchGuild(await database.getVoteTarget(userId))
        if (guild) attributedVia = 'target'
    }

    const { perVote, monthlyCap } = premiumManager.voteReward
    const result = await database.recordVote({
        source,
        userID: userId,
        guildID: guild?.id ?? null,
        perVote,
        monthlyCap,
        dedupeWindowMs: DEDUPE_WINDOW_MS
    })
    if (result.duplicate) {
        console.log(`[Votes] Ignored repeat ${source} vote from ${userId}`)
        return result
    }

    analytics.capture({
        event: 'vote_received',
        userId,
        guild,
        properties: {
            source,
            attributed_via: attributedVia,
            bonus_granted: result.bonusGranted,
            bonus_month_total: result.monthTotal,
            capped: !!guild && result.bonusGranted === 0
        }
    })

    sendThanks(client, { source, userId, guild, result, monthlyCap }).catch(() => {})
    return result
}

async function sendThanks(client, { source, userId, guild, result, monthlyCap }) {
    const listName = SOURCES[source].name
    const language = await getLanguage(guild?.id)
    let text
    if (!guild) {
        text = getLocale(language, 'voteThanksUnattributed', listName)
    } else if (result.bonusGranted > 0) {
        text = getLocale(language, 'voteThanksRewarded', listName, guild.name,
            String(result.bonusGranted), String(result.monthTotal), String(monthlyCap))
    } else {
        text = getLocale(language, 'voteThanksCapped', listName, guild.name, String(monthlyCap))
    }
    const embed = new EmbedBuilder().setDescription(text).setColor(0x57F287)
    try {
        await client.users.send(userId, { embeds: [embed] })
    } catch {
        // DMs closed or no mutual server — the reward was granted regardless.
    }
}

module.exports = {
    SOURCES,
    isEnabled,
    activeSources,
    getVoteStatus,
    voteButtonRow,
    showVotePrompt,
    limitReachedMessage,
    quotaWarningExtras,
    bonusStatusLine,
    processVote
}
