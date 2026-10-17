// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const config = require("../../config/config.json")
const { defaultLanguage, getLocale } = require("../Language")
const database = require("../database/Database")
const { MessageFlags, EmbedBuilder } = require('discord.js')
const ErrorNotifier = require('../utils/ErrorNotifier')
const OperatorWebhook = require('../utils/OperatorWebhook')
const SelfSmtpProvider = require('./providers/SelfSmtpProvider')
const ZeptoMailProvider = require('./providers/ZeptoMailProvider')
const premiumManager = require('../premium/PremiumManager')
const { buildPlanButtons, getWebsiteUrl, mobileHintLine } = require('../utils/premiumButtons')
const { createInvalidEmailEmbed } = require('../utils/embeds')
const analytics = require('../utils/Analytics')
const voting = require('../utils/voting')

// ZeptoMail outages typically affect every guild at once, so throttle the
// operator-webhook notification to one ping per 24h globally. The console.warn
// still fires on every failure for forensic visibility — only the webhook is
// rate-limited so the operator isn't spammed during a long outage.
const ZEPTO_FALLBACK_WEBHOOK_INTERVAL_MS = 24 * 60 * 60 * 1000

// <html lang> for the styled email; language file names aren't language tags.
const HTML_LANG = {
    english: 'en', german: 'de', french: 'fr', spanish: 'es', brazilianPortuguese: 'pt-BR',
    polish: 'pl', turkish: 'tr', hebrew: 'he', korean: 'ko', thai: 'th'
}
const RTL_LANGUAGES = new Set(['hebrew'])

// Display name on every verification email. A recognizable service name, the same
// in every language, matching the logo and footer of the styled email.
const SENDER_NAME = 'EmailVerify'

module.exports = class MailSender {
    /**
     * @param {Object} serverStatsAPI
     * @param {{codeTtlMs?: number}} [options] - codeTtlMs: how long a code stays valid,
     *   shown in the styled email; the line is left out when not given.
     */
    constructor(serverStatsAPI, { codeTtlMs } = {}) {
        this.serverStatsAPI = serverStatsAPI
        this.zeptoFallbackLastWebhookAt = 0
        this.codeTtlMinutes = codeTtlMs ? Math.round(codeTtlMs / 60000) : null

        const username = typeof config.username === 'undefined' ? config.email : config.username
        this.username = username
        // Address the mail is sent *from*, which is not always the SMTP login — see
        // SelfSmtpProvider. Used for the From header and List-Unsubscribe mailto, both
        // of which have to be a real mailbox.
        this.fromAddress = config.email || username

        this.selfProvider = new SelfSmtpProvider({
            smtpHost: config.smtpHost,
            username,
            password: config.password,
            smtpPort: config.smtpPort,
            isSecure: config.isSecure,
            isGoogle: config.isGoogle,
            fromAddress: this.fromAddress
        })

        const zeptoCfg = config.zeptomail || {}
        if (zeptoCfg.enabled && zeptoCfg.apiToken && zeptoCfg.fromAddress) {
            try {
                this.zeptoProvider = new ZeptoMailProvider({
                    apiToken: zeptoCfg.apiToken,
                    endpoint: zeptoCfg.endpoint,
                    fromAddress: zeptoCfg.fromAddress,
                    fromName: zeptoCfg.fromName
                })
            } catch (err) {
                console.error('[MailSender] ZeptoMail disabled - bad config:', err.message)
                this.zeptoProvider = null
            }
        } else {
            this.zeptoProvider = null
        }

        this.freeMonthlyLimit = config.monetization?.freeMonthlyLimit ?? 25
    }

    /**
     * Send verification email
     * @param {string} toEmail
     * @param {string} code
     * @param {string} name - Server name
     * @param {Interaction} interaction
     * @param {boolean} emailNotify
     * @param {Function} callback - Called with accepted email on success
     * @param {string} [premiumSource='free'] - 'subscription' | 'credits' | 'free' | 'disabled'
     * @param {string} [emailStyle='styled'] - 'styled' | 'plain'
     * @param {import('discord.js').Guild} [guild=null] - resolved guild; required for the DM
     *   verification flow where interaction.guild / interaction.guildId are null.
     * @param {Object} [preloadedSettings=null] - already-loaded ServerSettings; when the
     *   caller just read them, passing them here skips a redundant DB read.
     */
    async sendEmail(toEmail, code, name, interaction, emailNotify, callback, premiumSource = 'free', emailStyle = 'styled', guild = null, preloadedSettings = null) {
        // Prefer the explicit guild: in the DM flow interaction.guild/guildId are null.
        const ctxGuild = guild || interaction.guild || null
        const serverId = ctxGuild?.id || interaction.guildId

        const proceed = async (serverSettings) => {
            const language = serverSettings.language || defaultLanguage
            const plainText = getLocale(language, "emailText", name, code)
            // The code goes in the subject so mail clients can detect it: Gmail offers
            // "Copy code", iOS/macOS Mail offers it in AutoFill, and it shows in
            // notification previews. A distinct subject per code also stops Gmail from
            // threading a resent code under an older, already-invalid one.
            const emailSubject = getLocale(language, "emailSubject", code)
            const html = emailStyle === 'styled'
                ? this.#buildLocalizedHtmlEmail(language, name, code)
                : null

            const sendOpts = {
                fromName: SENDER_NAME,
                from: this.fromAddress,
                to: toEmail,
                subject: emailSubject,
                text: plainText,
                html,
                headers: {
                    'X-Mailer': 'EmailVerify',
                    'List-Unsubscribe': `<mailto:${this.fromAddress}?subject=unsubscribe>`,
                    'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
                }
            }

            const useZepto = this.zeptoProvider && (premiumSource === 'subscription' || premiumSource === 'credits-zepto')
            let info = null
            let usedProvider = null
            let lastError = null
            let invalidRecipient = false

            if (useZepto) {
                try {
                    info = await this.zeptoProvider.sendMail(sendOpts)
                    usedProvider = 'zeptomail'
                } catch (err) {
                    lastError = err
                    if (err.invalidRecipient) {
                        // The member typed an address the provider won't accept. Self-SMTP
                        // would reject the same address, so there is nothing to fall back
                        // to — and this must not consume the global 24h outage-alert budget,
                        // or one typo would mask a real ZeptoMail outage for the rest of the day.
                        invalidRecipient = true
                        console.warn(`[MailSender] ZeptoMail rejected the recipient for guild=${ctxGuild?.id ?? 'unknown'}:`, err.message)
                    } else {
                        console.warn(`[MailSender] ZeptoMail send failed for guild=${ctxGuild?.id ?? 'unknown'} — falling back to self-SMTP:`, err.message)
                        const now = Date.now()
                        if (now - this.zeptoFallbackLastWebhookAt >= ZEPTO_FALLBACK_WEBHOOK_INTERVAL_MS) {
                            this.zeptoFallbackLastWebhookAt = now
                            OperatorWebhook.notify({
                                title: '✉️ ZeptoMail fallback',
                                description: 'A premium mail send failed and was retried on self-SMTP. The retry usually succeeds, but it is not guaranteed — check stdout if users report failures. Recipient addresses rejected by ZeptoMail are not reported here. This alert is throttled to once per 24h; further fallbacks during this window are logged to stdout only.',
                                fields: [
                                    { name: 'Guild', value: ctxGuild?.id ? `\`${ctxGuild.id}\` (${ctxGuild.name})` : 'n/a', inline: false },
                                    { name: 'Error', value: `\`${(err?.message || 'unknown').slice(0, 1000)}\``, inline: false }
                                ],
                                level: 'warn'
                            })
                        }
                    }
                }
            }

            if (!info && !invalidRecipient) {
                try {
                    info = await this.selfProvider.sendMail(sendOpts)
                    usedProvider = 'self-smtp'
                } catch (err) {
                    lastError = err
                    info = null
                }
            }

            const failed = !info || (info.rejected && info.rejected.length > 0)

            if (failed) {
                analytics.capture({
                    event: 'mail_failed',
                    userId: interaction.user?.id || null,
                    guildId: serverId,
                    guild: ctxGuild,
                    properties: {
                        // usedProvider is only set once a provider accepted the message;
                        // on a rejected recipient we never got that far but do know who
                        // rejected it.
                        provider_attempted: usedProvider || (invalidRecipient ? 'zeptomail' : 'unknown'),
                        source: premiumSource,
                        reason: invalidRecipient ? 'invalid_recipient' : 'send_failed'
                    }
                })
                if (emailNotify) {
                    console.log('EMAIL ERROR for:', toEmail)
                    console.log('Error details:', lastError)
                    if (info && info.rejected && info.rejected.length > 0) {
                        console.log('Rejected emails:', info.rejected)
                    }
                    if (info && info.response) {
                        console.log('SMTP Response:', info.response)
                    }
                }
                // canSendMail() consumed a credit before this attempt — refund it since
                // no verification mail was actually delivered.
                if (premiumSource === 'credits' || premiumSource === 'credits-zepto') {
                    database.refundGuildCredit(serverId).catch(() => {})
                }
                // A rejected recipient is the member's typo, not an outage — point them at
                // the address instead of showing the generic "mail system failed" embed.
                const errorEmbed = invalidRecipient
                    ? createInvalidEmailEmbed(language)
                    : new EmbedBuilder()
                        .setTitle(getLocale(language, "mailFailedTitle"))
                        .setDescription(getLocale(language, "mailFailedDescription", toEmail))
                        .setColor(0xED4245)
                // A deferred-but-unreplied interaction is resolved via editReply so the
                // "Bot is thinking…" state never hangs on delivery failure.
                if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {})
                } else if (interaction.replied) {
                    await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                } else {
                    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                }
                return
            }

            this.serverStatsAPI.increaseMailSend()
            analytics.capture({
                event: 'mail_sent',
                userId: interaction.user?.id || null,
                guildId: serverId,
                guild: ctxGuild,
                properties: { provider: usedProvider, source: premiumSource, email_style: emailStyle }
            })

            try {
                // This month's limit includes any vote bonus, so warnings track the real quota.
                const freeLimit = premiumSource === 'free' ? await premiumManager.getFreeLimit(serverId) : this.freeMonthlyLimit
                const crossings = await database.recordMailSentAndCheckThresholds(serverId, premiumSource, freeLimit)
                this.#fireQuotaWarnings(interaction, language, serverSettings, crossings, ctxGuild, freeLimit)
                if (premiumSource === 'credits-zepto' && crossings.creditsRemaining !== null && crossings.creditsRemaining <= 0) {
                    this.#maybeAutoDisableZeptoMode(interaction, language, ctxGuild)
                }
            } catch (e) {
                console.error('[MailSender] Failed to record/check thresholds:', e)
                database.incrementMailsSent(serverId)
            }

            const accepted = info.accepted && info.accepted.length > 0 ? info.accepted[0] : toEmail
            callback(accepted)

            if (emailNotify) {
                console.log('EMAIL SUCCESS for:', toEmail, 'via', usedProvider)
                if (info.messageId) console.log('Message ID:', info.messageId)
                if (info.response) console.log('Provider response:', info.response)
            }
        }

        if (preloadedSettings) {
            await proceed(preloadedSettings)
        } else {
            await database.getServerSettings(serverId, proceed)
        }
    }

    /**
     * Verify the self-SMTP transport at boot (connect + auth, no mail sent).
     * Returns { ok, error } instead of throwing.
     */
    async selfTest() {
        try {
            await this.selfProvider.verify()
            return { ok: true }
        } catch (e) {
            return { ok: false, error: e?.message || String(e) }
        }
    }

    /**
     * Send a test verification email through the normal provider path (same template,
     * same provider selection and fallback as real sends — that's the point of the
     * test). The caller must have admitted the send via premiumManager.canSendMail
     * and passes its `source`; on delivery failure a consumed credit is refunded.
     * Counts against the guild's monthly counters (no threshold warnings fired —
     * flags stay untripped, so the next real send still warns).
     *
     * @returns {Promise<{ok: boolean, provider?: string, messageId?: string, latencyMs?: number, error?: string}>}
     */
    async sendTestEmail({ toEmail, guildId, guildName, language, emailStyle, premiumSource }) {
        const lang = language || defaultLanguage
        const code = require('crypto').randomInt(100000, 1000000).toString()
        const html = emailStyle === 'styled' ? this.#buildLocalizedHtmlEmail(lang, guildName, code) : null

        const sendOpts = {
            fromName: SENDER_NAME,
            from: this.fromAddress,
            to: toEmail,
            subject: getLocale(lang, 'emailSubject', code),
            text: getLocale(lang, 'emailText', guildName, code),
            html,
            headers: {
                'X-Mailer': 'EmailVerify',
                'List-Unsubscribe': `<mailto:${this.fromAddress}?subject=unsubscribe>`,
                'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
            }
        }

        const useZepto = this.zeptoProvider && (premiumSource === 'subscription' || premiumSource === 'credits-zepto')
        const start = Date.now()
        let info = null
        let usedProvider = null
        let lastError = null

        let invalidRecipient = false

        if (useZepto) {
            try {
                info = await this.zeptoProvider.sendMail(sendOpts)
                usedProvider = 'zeptomail'
            } catch (err) {
                lastError = err
                if (err.invalidRecipient) {
                    // Same reasoning as sendEmail: self-SMTP cannot rescue an address the
                    // provider rejected, so report it to the admin as what it is.
                    invalidRecipient = true
                    console.warn(`[MailSender] ZeptoMail rejected the test recipient for guild=${guildId}:`, err.message)
                } else {
                    console.warn(`[MailSender] ZeptoMail test send failed for guild=${guildId} — falling back to self-SMTP:`, err.message)
                }
            }
        }
        if (!info && !invalidRecipient) {
            try {
                info = await this.selfProvider.sendMail(sendOpts)
                usedProvider = 'self-smtp'
            } catch (err) {
                lastError = err
                info = null
            }
        }

        const failed = !info || (info.rejected && info.rejected.length > 0)
        if (failed) {
            if (premiumSource === 'credits' || premiumSource === 'credits-zepto') {
                database.refundGuildCredit(guildId).catch(() => {})
            }
            if (invalidRecipient) {
                return { ok: false, error: 'The mail provider rejected that address as invalid — double-check the spelling and the domain.' }
            }
            const rejectedNote = info?.rejected?.length ? `Rejected: ${info.rejected.join(', ')}` : null
            return { ok: false, error: lastError?.message || rejectedNote || 'unknown error' }
        }

        this.serverStatsAPI.increaseMailSend()
        database.incrementMailsSent(guildId)
        analytics.capture({
            event: 'mail_sent',
            guildId,
            properties: { provider: usedProvider, source: premiumSource, email_style: emailStyle, test: true }
        })
        return { ok: true, provider: usedProvider, messageId: info.messageId || null, latencyMs: Date.now() - start }
    }

    async #maybeAutoDisableZeptoMode(interaction, language, guild = null) {
        guild = guild || interaction?.guild
        if (!guild) return
        try {
            const flipped = await database.tryAutoDisableZeptoMode(guild.id)
            if (flipped) {
                await premiumManager.notifyZeptoModeAutoDisabled(guild, language)
            }
        } catch (e) {
            console.error('[MailSender] Failed to auto-disable zepto mode:', e)
        }
    }

    async #fireQuotaWarnings(interaction, language, serverSettings, crossings, guild = null, freeLimit = this.freeMonthlyLimit) {
        guild = guild || interaction?.guild
        if (!guild || !crossings) return

        const anyCrossed = crossings.crossed80 || crossings.crossed95 || crossings.crossed100
            || crossings.crossedCreditsLow || crossings.crossedCreditsZero
        if (!anyCrossed) return

        const quotaUserId = interaction?.user?.id || null
        if (crossings.crossed80) analytics.capture({ event: 'mail_quota_threshold_crossed', userId: quotaUserId, guild, properties: { threshold: '80' } })
        if (crossings.crossed95) analytics.capture({ event: 'mail_quota_threshold_crossed', userId: quotaUserId, guild, properties: { threshold: '95' } })
        if (crossings.crossed100) analytics.capture({ event: 'mail_quota_threshold_crossed', userId: quotaUserId, guild, properties: { threshold: '100' } })
        if (crossings.crossedCreditsLow) analytics.capture({ event: 'mail_quota_threshold_crossed', userId: quotaUserId, guild, properties: { threshold: 'credits_low' } })
        if (crossings.crossedCreditsZero) analytics.capture({ event: 'mail_quota_threshold_crossed', userId: quotaUserId, guild, properties: { threshold: 'credits_zero' } })

        // Build Premium buttons + website footer once so each crossing reuses them.
        let components = null
        try {
            const premiumStatus = await premiumManager.getPremiumStatus(guild.id, interaction.entitlements)
            const rows = buildPlanButtons(premiumStatus, { context: 'quotaWarn' })
            if (rows.length > 0) components = rows
        } catch (e) {
            // Without premium status we still send the warning, just without buttons.
            console.warn('[MailSender] Could not build premium buttons for quota warning:', e.message)
        }

        let footer = this.#buildQuotaFooter(language, getWebsiteUrl())

        // Voting is the free way to more emails: offer it next to the paid plans on the
        // free-quota warnings. A single send crosses either free-quota or credit
        // thresholds, never both, and credit warnings go to servers that already pay.
        if (crossings.crossed80 || crossings.crossed95 || crossings.crossed100) {
            const vote = await voting.quotaWarningExtras(language, guild.id)
            if (vote) {
                footer = `${vote.line}\n\n${footer}`
                components = [...(components || []), vote.row].slice(0, 5)
            }
        }

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
        const forecast = premiumManager.forecastLine(language, crossings.mailsSentMonth, freeLimit)

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
            this.#postPublicLimitNotice(interaction, language, guild.id).catch(() => {})
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

    async #postPublicLimitNotice(interaction, language, guildId) {
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
            // Carries the vote button, so any member in the channel can add emails back.
            await channel.send(await voting.limitReachedMessage(language, guildId))
        } catch (e) {
            // Missing send permission is fine — the admin DM path still fires.
        }
    }

    #escapeHtml(input) {
        if (typeof input !== 'string') return input
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    #buildLocalizedHtmlEmail(language, serverName, code) {
        const safeServerName = this.#escapeHtml(serverName || '')
        const safeCode = this.#escapeHtml(code || '')

        const title = this.#escapeHtml(getLocale(language, 'emailHtmlTitle'))
        const serverIntro = this.#escapeHtml(getLocale(language, 'emailHtmlServerIntro'))
        const codeIntro = this.#escapeHtml(getLocale(language, 'emailHtmlCodeIntro'))
        const ignoreNote = this.#escapeHtml(getLocale(language, 'emailHtmlIgnoreNote'))
        const noReply = this.#escapeHtml(getLocale(language, 'emailHtmlNoReply'))
        const moreInfo = this.#escapeHtml(getLocale(language, 'emailHtmlMoreInfo'))
        const expiry = this.codeTtlMinutes
            ? this.#escapeHtml(getLocale(language, 'emailHtmlExpiry', String(this.codeTtlMinutes)))
            : null
        // Hidden preheader: the inbox preview shows the code instead of the heading, and
        // code detectors get the keyword and the number in a single sentence.
        const preheader = this.#escapeHtml(getLocale(language, 'emailSubject', code || ''))
        const htmlLang = HTML_LANG[language] || 'en'
        const dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'

        const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        const mono = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace"
        const siteUrl = 'https://getemailverified.com/?utm_source=email&amp;utm_medium=verification'

        // Email HTML: layout tables and inline styles, since many clients drop <style>.
        // The <style> block only adds what degrades gracefully without it: dark mode
        // (Apple Mail; Gmail recolours on its own) and tighter spacing on phones. The
        // code's right padding is smaller by the letter-spacing, which trails the last
        // digit, so the digits sit centred.
        return `<!doctype html>
<html lang="${htmlLang}" dir="${dir}">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${title}</title>
    <style>
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
      @media (prefers-color-scheme: dark) {
        .ev-page { background-color: #0f1115 !important; }
        .ev-card { background-color: #1a1d24 !important; border-color: #2a2f3a !important; }
        .ev-text { color: #e6e8eb !important; }
        .ev-muted { color: #a0a8b4 !important; }
        .ev-code { background-color: #252a4a !important; border-color: #3d4590 !important; color: #ffffff !important; }
        .ev-rule { border-color: #2a2f3a !important; }
        .ev-link { color: #a5b4fc !important; }
      }
      @media (max-width: 600px) {
        .ev-card { padding: 32px 20px 24px 20px !important; }
        .ev-code { font-size: 28px !important; letter-spacing: 6px !important; padding: 12px 14px 12px 20px !important; }
      }
    </style>
  </head>
  <body class="ev-page" style="margin:0; padding:0; background-color:#f6f8fa;">
    <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${preheader}</div>
    <table role="presentation" class="ev-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f8fa" style="background-color:#f6f8fa;">
      <tr>
        <td align="center" style="padding:32px 16px 40px 16px;">
          <!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
            <tr>
              <td align="center" style="padding:0 0 20px 0;">
                <img src="https://getemailverified.com/assets/favicon-192x192.png" width="48" height="48" alt="EmailVerify" style="display:block; width:48px; height:48px; border:0; border-radius:12px;" />
              </td>
            </tr>
            <tr>
              <td class="ev-card" align="center" bgcolor="#ffffff" style="background-color:#ffffff; border:1px solid #e3e8ef; border-radius:16px; padding:40px 40px 32px 40px; font-family:${font}; text-align:center;">
                <h1 class="ev-text" style="margin:0 0 16px 0; font-family:${font}; font-size:24px; line-height:32px; font-weight:700; color:#1f2937;">${title}</h1>
                <p class="ev-muted" style="margin:0; font-size:15px; line-height:22px; color:#5b6472;">${serverIntro}</p>
                <p class="ev-text" style="margin:4px 0 28px 0; font-size:17px; line-height:24px; font-weight:600; color:#1f2937;">${safeServerName}</p>
                <p class="ev-text" style="margin:0 0 14px 0; font-size:15px; line-height:22px; color:#1f2937;">${codeIntro}</p>
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td class="ev-code" dir="ltr" bgcolor="#eef0fe" style="background-color:#eef0fe; border:1px solid #d4d8fd; border-radius:12px; padding:14px 20px 14px 28px; font-family:${mono}; font-size:34px; line-height:44px; font-weight:700; letter-spacing:8px; color:#1f2937; -webkit-user-select:all; user-select:all;">${safeCode}</td>
                  </tr>
                </table>${expiry ? `
                <p class="ev-muted" style="margin:14px 0 0 0; font-size:13px; line-height:20px; color:#5b6472;">${expiry}</p>` : ''}
                <hr class="ev-rule" style="border:none; border-top:1px solid #e3e8ef; margin:32px 0 20px 0;" />
                <p class="ev-muted" style="margin:0; font-size:13px; line-height:20px; color:#5b6472;">${ignoreNote} ${noReply}</p>
              </td>
            </tr>
            <tr>
              <td align="center" class="ev-muted" style="padding:20px 16px 0 16px; font-family:${font}; font-size:12px; line-height:18px; color:#8a93a1;">
                ${moreInfo} <a class="ev-link" href="${siteUrl}" style="color:#5865f2; text-decoration:none;">getemailverified.com</a>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`
    }
}
