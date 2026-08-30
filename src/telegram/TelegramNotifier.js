// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { getLocale } = require('../Language')
const analytics = require('../utils/Analytics')
const premiumManager = require('../premium/PremiumManager')
const { nativeId } = require('../core/PlatformKey')

const EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS = 60 * 60 * 1000

/**
 * Admin-facing notifications for the Telegram side.
 *
 * Discord has an ErrorNotifier that can DM the owner, ping a role, or post to a
 * channel. Telegram has none of that, and a bot may not message an administrator
 * who has never started it — so notifications go to the gated chat's
 * administrators where possible, and are silently dropped where not. Every hook is
 * fire-and-forget: VerificationService must never be broken by a failed notice.
 */
class TelegramNotifier {
    constructor(telegram) {
        this.telegram = telegram
        this.emaillistLockedLastNotify = new Map()
    }

    notConfigured(ctx) {
        return this.#toAdmins(ctx, getLocale(ctx.language, 'telegramNotConfigured'))
    }

    emaillistLocked(ctx) {
        const last = this.emaillistLockedLastNotify.get(ctx.community.id) || 0
        if (Date.now() - last < EMAILLIST_LOCKED_NOTIFY_INTERVAL_MS) return
        this.emaillistLockedLastNotify.set(ctx.community.id, Date.now())
        return this.#toAdmins(ctx, getLocale(ctx.language, 'emaillistLockedAdminMessage'))
    }

    mailDenied(ctx) {
        return this.#toAdmins(ctx, getLocale(
            ctx.language, 'telegramMailDeniedAdmin', '1', ctx.community.name
        ))
    }

    zeptoAutoDisabled(ctx) {
        analytics.capture({ event: 'zepto_mode_auto_disabled', guild: ctx.community })
        return this.#toAdmins(ctx, getLocale(ctx.language, 'zeptoModeAutoDisabledMessage'))
    }

    authorizationFailed(ctx) {
        return this.#toAdmins(ctx, getLocale(
            ctx.language, 'telegramAuthFailedAdmin', ctx.community.name
        ))
    }

    /** Verification log line, if the admin pointed logChannel at a chat. */
    verified(ctx, { email, labels }) {
        if (!ctx.settings.logChannel) return
        const chats = labels.length ? ` [${labels.join(', ')}]` : ''
        return this.telegram.sendMessage(
            Number(nativeId(ctx.settings.logChannel)),
            `✅ ${ctx.userID} → ${email}${chats}`
        ).catch(() => {})
    }

    async quotaWarnings(ctx, crossings) {
        if (!crossings) return
        const limit = premiumManager.freeMonthlyLimit
        const lang = ctx.language

        if (crossings.crossed100 || crossings.crossedCreditsZero) {
            await this.#toAdmins(ctx, getLocale(lang, 'telegramQuotaExhaustedAdmin', ctx.community.name))
        } else if (crossings.crossed80 || crossings.crossed95) {
            let msg = getLocale(lang, 'telegramQuotaWarnAdmin',
                String(crossings.mailsSentMonth ?? ''), String(limit), ctx.community.name)
            // Telegram has no timestamp markup, so the forecast renders as a plain date.
            const forecast = premiumManager.forecastLine(lang, crossings.mailsSentMonth, premiumManager.plainDate)
            if (forecast) msg += `\n\n${forecast}`
            await this.#toAdmins(ctx, msg)
        } else {
            return
        }

        const track = (threshold) => analytics.capture({
            event: 'mail_quota_threshold_crossed', userId: ctx.userID, guild: ctx.community, properties: { threshold }
        })
        if (crossings.crossed80) track('80')
        if (crossings.crossed95) track('95')
        if (crossings.crossed100) track('100')
        if (crossings.crossedCreditsLow) track('credits_low')
        if (crossings.crossedCreditsZero) track('credits_zero')
    }

    /**
     * Message the administrators of the gated chat. Admins who never started the bot
     * are unreachable — that is a platform limit, not an error, so failures are
     * swallowed per-recipient rather than aborting the rest.
     */
    async #toAdmins(ctx, text) {
        const chatKey = (ctx.settings.managedChats || [])[0]
        if (!chatKey) return
        let admins = []
        try {
            admins = await this.telegram.getChatAdministrators(Number(nativeId(chatKey)))
        } catch {
            return
        }
        for (const admin of admins) {
            if (admin?.user?.is_bot) continue
            try {
                await this.telegram.sendMessage(admin.user.id, text, { parse_mode: 'Markdown' })
            } catch { /* never started the bot, or blocked it */ }
        }
    }
}

module.exports = TelegramNotifier
