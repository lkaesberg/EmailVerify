// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { getLocale } = require('../Language')
const database = require('../database/Database')
const analytics = require('../utils/Analytics')
const ErrorNotifier = require('../utils/ErrorNotifier')
const premiumManager = require('../premium/PremiumManager')
const { buildPlanButtons, getWebsiteUrl, mobileHintLine } = require('../utils/premiumButtons')
const { createMailLimitReachedEmbed } = require('../utils/embeds')

// The "your uploaded email list is locked" nudge fires on every blocked
// verification, so throttle it to one admin ping per guild per hour.
const EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS = 60 * 60 * 1000

/**
 * The admin- and operator-facing side of verification, in Discord's vocabulary.
 *
 * VerificationService calls these hooks and ignores what they do; everything here
 * is fire-and-forget and must never throw back into the verification flow. The
 * Telegram adapter provides its own object with the same hook names.
 *
 * ctx is { community (Guild), settings, userID, language, passthrough }, where
 * passthrough carries the Discord interaction and whether the user should be
 * answered through it (the code-submit path answers the user itself, so admin
 * notifications there must not also followUp).
 */
class DiscordNotifier {
    constructor() {
        this.emaillistLockedLastNotify = new Map()
    }

    notConfigured(ctx) {
        const { community, language, passthrough } = ctx
        ErrorNotifier.notify({
            guild: community,
            errorTitle: getLocale(language, 'errorBotNotConfiguredTitle'),
            errorMessage: getLocale(language, 'errorBotNotConfiguredMessage'),
            user: passthrough?.interaction?.user,
            // Only the email-submit path lets ErrorNotifier answer the user for us;
            // on code submit the adapter has a deferred reply it must resolve itself.
            interaction: passthrough?.notifyViaInteraction ? passthrough.interaction : undefined,
            language
        }).catch(() => {})
    }

    emaillistLocked(ctx) {
        const { community, language } = ctx
        const last = this.emaillistLockedLastNotify.get(community.id) || 0
        if (Date.now() - last < EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS) return
        this.emaillistLockedLastNotify.set(community.id, Date.now())
        ErrorNotifier.notify({
            guild: community,
            errorTitle: getLocale(language, 'emaillistLockedAdminTitle'),
            errorMessage: getLocale(language, 'emaillistLockedAdminMessage'),
            language
        }).catch(() => {})
    }

    mailDenied(ctx) {
        return premiumManager.notifyMailDenied(ctx.community, ctx.language)
    }

    zeptoAutoDisabled(ctx) {
        return premiumManager.notifyZeptoModeAutoDisabled(ctx.community, ctx.language)
    }

    authorizationFailed(ctx) {
        const { community, language } = ctx
        ErrorNotifier.notify({
            guild: community,
            errorTitle: getLocale(language, 'errorRoleAssignTitle'),
            errorMessage: getLocale(language, 'errorRoleAssignMessage'),
            user: ctx.passthrough?.interaction?.user,
            language
        }).catch(() => {})
    }

    /** Verification log line in the guild's configured log channel. */
    async verified(ctx, { email, labels }) {
        const { community, settings } = ctx
        if (!settings.logChannel) return
        try {
            const rolesText = labels.length > 0 ? ` [${labels.join(', ')}]` : ''
            const logChannel = community.channels.cache.get(settings.logChannel)
                || await community.channels.fetch(settings.logChannel).catch(() => null)
            if (logChannel) {
                await logChannel.send(`✅ <@${ctx.userID}> → \`${email}\`${rolesText}`).catch(() => {})
            }
        } catch {}
    }

    /**
     * Escalating quota reminders. Each threshold is tripped at most once per month by
     * the database, so this only has to render what it is handed.
     */
    async quotaWarnings(ctx, crossings) {
        const { community: guild, language, passthrough } = ctx
        const interaction = passthrough?.interaction
        if (!guild || !crossings) return

        const anyCrossed = crossings.crossed80 || crossings.crossed95 || crossings.crossed100
            || crossings.crossedCreditsLow || crossings.crossedCreditsZero
        if (!anyCrossed) return

        const freeLimit = premiumManager.freeMonthlyLimit
        const quotaUserId = ctx.userID || null
        const track = (threshold) => analytics.capture({
            event: 'mail_quota_threshold_crossed', userId: quotaUserId, guild, properties: { threshold }
        })
        if (crossings.crossed80) track('80')
        if (crossings.crossed95) track('95')
        if (crossings.crossed100) track('100')
        if (crossings.crossedCreditsLow) track('credits_low')
        if (crossings.crossedCreditsZero) track('credits_zero')

        // Build Premium buttons + website footer once so each crossing reuses them.
        let components = null
        try {
            const premiumStatus = await premiumManager.getPremiumStatus(guild.id, interaction?.entitlements)
            const rows = buildPlanButtons(premiumStatus, { context: 'quotaWarn' })
            if (rows.length > 0) components = rows
        } catch (e) {
            // Without premium status we still send the warning, just without buttons.
            console.warn('[DiscordNotifier] Could not build premium buttons for quota warning:', e.message)
        }

        const footer = this.#buildQuotaFooter(language, getWebsiteUrl())

        const fire = (titleKey, msgKey, extraLine, ...vars) => {
            let baseMessage = getLocale(language, msgKey, ...vars)
            if (extraLine) baseMessage += `\n\n${extraLine}`
            ErrorNotifier.notify({
                guild,
                errorTitle: getLocale(language, titleKey),
                errorMessage: footer ? `${baseMessage}\n\n${footer}` : baseMessage,
                language,
                components
            }).catch(() => {})
        }

        // Deadline framing beats percentage framing: append "on pace to run out
        // around <date>" to the advisory warnings when the pace supports it.
        const forecast = premiumManager.forecastLine(language, crossings.mailsSentMonth, premiumManager.discordDate)

        if (crossings.crossed80) {
            fire('quotaWarn80Title', 'quotaWarn80Message', forecast, String(crossings.mailsSentMonth ?? ''), String(freeLimit))
        }
        if (crossings.crossed95) {
            fire('quotaWarn95Title', 'quotaWarn95Message', forecast, String(crossings.mailsSentMonth ?? ''), String(freeLimit))
        }
        if (crossings.crossed100) {
            fire('quotaWarn100Title', 'quotaWarn100Message', null, String(freeLimit))
        }
        if (crossings.crossedCreditsLow) {
            fire('quotaWarnCreditsLowTitle', 'quotaWarnCreditsLowMessage', null, String(crossings.creditsRemaining ?? 0))
        }
        if (crossings.crossedCreditsZero) {
            fire('quotaWarnCreditsZeroTitle', 'quotaWarnCreditsZeroMessage', null)
        }

        // Public-facing service notice in the verify channel: only on quota exhaustion
        // (100% or zero credits), not advisory crossings. This is what regular members
        // see so they can explain to themselves why verification stopped working.
        if (crossings.crossed100 || crossings.crossedCreditsZero) {
            this.#postPublicLimitNotice(interaction, language).catch(() => {})
        }
    }

    #buildQuotaFooter(language, websiteUrl) {
        const lines = [getLocale(language, 'quotaWarnFooterHint')]
        // Redeem reminder: buying a credit pack does nothing until /premium redeem is
        // run — spelling that out here prevents "I paid but nothing happened" refunds.
        lines.push(getLocale(language, 'quotaWarnRedeemHint'))
        // Discord mobile can't complete SKU purchases — point mobile admins at desktop/browser.
        const mobile = mobileHintLine(language)
        if (mobile) lines.push(mobile)
        if (websiteUrl) lines.push(getLocale(language, 'quotaWarnFooterWebsite', websiteUrl))
        return lines.join('\n')
    }

    async #postPublicLimitNotice(interaction, language) {
        // Post into the channel the user was actively verifying in — that's necessarily
        // the verify channel (or wherever the admin placed the verify button), and the
        // bot just used permissions there for the email modal, so the send should work.
        // We deliberately don't fall back to serverSettings.channelID — that field is
        // legacy reaction-flow state and isn't populated for new /button setups.
        const channel = interaction?.channel
        if (!channel || !channel.isTextBased?.()) return
        // In the DM verification flow the interaction channel is the user's DM — this
        // notice is for the guild's verify channel, so skip it there.
        if (channel.isDMBased?.()) return
        try {
            await channel.send({ embeds: [createMailLimitReachedEmbed(language, getWebsiteUrl())] })
        } catch (e) {
            // Missing send permission is fine — the admin DM path still fires.
        }
    }
}

module.exports = DiscordNotifier
