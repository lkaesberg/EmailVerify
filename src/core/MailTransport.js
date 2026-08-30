// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const config = require('../../config/config.json')
const { defaultLanguage, getLocale } = require('../Language')
const database = require('../database/Database')
const OperatorWebhook = require('../utils/OperatorWebhook')
const SelfSmtpProvider = require('../mail/providers/SelfSmtpProvider')
const ZeptoMailProvider = require('../mail/providers/ZeptoMailProvider')

// ZeptoMail outages typically affect every community at once, so throttle the
// operator-webhook notification to one ping per 24h globally. The console.warn
// still fires on every failure for forensic visibility — only the webhook is
// rate-limited so the operator isn't spammed during a long outage.
const ZEPTO_FALLBACK_WEBHOOK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Delivery of verification emails, with no knowledge of the chat platform that
 * asked for one.
 *
 * This is the half of the old MailSender that Telegram needs verbatim: provider
 * selection, the ZeptoMail→self-SMTP fallback, the credit refund when nothing was
 * actually delivered, and the localized message bodies. Everything that renders a
 * result to a user — embeds, interaction replies, quota-warning notifications —
 * stays in the platform adapter, because that is the part the two platforms cannot
 * share.
 */
class MailTransport {
    constructor({ serverStatsAPI = null } = {}) {
        this.serverStatsAPI = serverStatsAPI
        this.zeptoFallbackLastWebhookAt = 0

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
                console.error('[MailTransport] ZeptoMail disabled - bad config:', err.message)
                this.zeptoProvider = null
            }
        } else {
            this.zeptoProvider = null
        }
    }

    /**
     * Deliver one verification code.
     *
     * Never throws and never reports a partial success: a rejected recipient counts
     * as failure, because the caller uses `ok` to decide whether to persist the
     * pending code at all.
     *
     * @param {Object}  opts
     * @param {string}  opts.toEmail
     * @param {string}  opts.code
     * @param {string}  opts.communityName  server/group name shown in the email
     * @param {string}  opts.guildID        storage key, for the credit refund
     * @param {string}  [opts.language]
     * @param {'plain'|'styled'} [opts.emailStyle]
     * @param {string}  [opts.premiumSource] 'subscription'|'credits-zepto'|'credits'|'free'|'disabled'
     * @param {string}  [opts.guildLabel]   human-readable id for operator alerts only
     * @returns {Promise<{ok: boolean, provider: ?string, messageId: ?string, accepted: ?string, latencyMs: number, error: ?string, rejected: ?string[]}>}
     */
    async send({ toEmail, code, communityName, guildID, language, emailStyle = 'plain', premiumSource = 'free', guildLabel = null }) {
        const lang = language || defaultLanguage
        const sendOpts = this.buildMessage({ toEmail, code, communityName, language: lang, emailStyle })

        const useZepto = this.zeptoProvider && (premiumSource === 'subscription' || premiumSource === 'credits-zepto')
        const start = Date.now()
        let info = null
        let usedProvider = null
        let lastError = null

        if (useZepto) {
            try {
                info = await this.zeptoProvider.sendMail(sendOpts)
                usedProvider = 'zeptomail'
            } catch (err) {
                lastError = err
                console.warn(`[MailTransport] ZeptoMail send failed for guild=${guildID ?? 'unknown'} — falling back to self-SMTP:`, err.message)
                this.#throttledFallbackWebhook(guildID, guildLabel, err)
            }
        }

        if (!info) {
            try {
                info = await this.selfProvider.sendMail(sendOpts)
                usedProvider = 'self-smtp'
            } catch (err) {
                lastError = err
                info = null
            }
        }

        const rejected = info && info.rejected && info.rejected.length > 0 ? info.rejected : null
        if (!info || rejected) {
            // canSendMail() consumed a credit before this attempt — refund it since
            // no verification mail was actually delivered.
            if (guildID && (premiumSource === 'credits' || premiumSource === 'credits-zepto')) {
                database.refundGuildCredit(guildID).catch(() => {})
            }
            return {
                ok: false,
                provider: usedProvider,
                messageId: null,
                accepted: null,
                latencyMs: Date.now() - start,
                error: lastError?.message || (rejected ? `Rejected: ${rejected.join(', ')}` : 'unknown error'),
                rejected,
                response: info?.response || null
            }
        }

        this.serverStatsAPI?.increaseMailSend()

        return {
            ok: true,
            provider: usedProvider,
            messageId: info.messageId || null,
            accepted: info.accepted && info.accepted.length > 0 ? info.accepted[0] : toEmail,
            latencyMs: Date.now() - start,
            error: null,
            rejected: null,
            response: info.response || null
        }
    }

    /** The provider payload for a verification email, in the community's language. */
    buildMessage({ toEmail, code, communityName, language, emailStyle = 'plain' }) {
        const lang = language || defaultLanguage
        return {
            fromName: getLocale(lang, 'emailSenderName'),
            from: this.fromAddress,
            to: toEmail,
            subject: getLocale(lang, 'emailSubject'),
            text: getLocale(lang, 'emailText', communityName, code),
            html: emailStyle === 'styled' ? this.buildLocalizedHtmlEmail(lang, communityName, code) : null,
            headers: {
                'X-Mailer': 'EmailVerify',
                'List-Unsubscribe': `<mailto:${this.fromAddress}?subject=unsubscribe>`,
                'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
            }
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

    #throttledFallbackWebhook(guildID, guildLabel, err) {
        const now = Date.now()
        if (now - this.zeptoFallbackLastWebhookAt < ZEPTO_FALLBACK_WEBHOOK_INTERVAL_MS) return
        this.zeptoFallbackLastWebhookAt = now
        OperatorWebhook.notify({
            title: '✉️ ZeptoMail fallback',
            description: 'A premium mail send failed; falling back to self-SMTP. Verification still completes for the user. This alert is throttled to once per 24h — further fallbacks during this window are logged to stdout only.',
            fields: [
                { name: 'Guild', value: guildID ? `\`${guildID}\` (${guildLabel || 'unknown'})` : 'n/a', inline: false },
                { name: 'Error', value: `\`${(err?.message || 'unknown').slice(0, 1000)}\``, inline: false }
            ],
            level: 'warn'
        })
    }

    escapeHtml(input) {
        if (typeof input !== 'string') return input
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    buildLocalizedHtmlEmail(language, serverName, code) {
        const safeServerName = this.escapeHtml(serverName || '')
        const safeCode = this.escapeHtml(code || '')

        const greeting = this.escapeHtml(getLocale(language, 'emailHtmlGreeting'))
        const serverIntro = this.escapeHtml(getLocale(language, 'emailHtmlServerIntro'))
        const codeIntro = this.escapeHtml(getLocale(language, 'emailHtmlCodeIntro'))
        const ignoreNote = this.escapeHtml(getLocale(language, 'emailHtmlIgnoreNote'))
        const noReply = this.escapeHtml(getLocale(language, 'emailHtmlNoReply'))
        const moreInfo = this.escapeHtml(getLocale(language, 'emailHtmlMoreInfo'))

        return `<!doctype html>
<html lang="${this.escapeHtml(language).slice(0, 5)}">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>EmailVerify</title>
    <style>
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#f6f6f6;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f6f6;">
      <tr>
        <td align="center" style="padding:40px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px; background:#ffffff; border-radius:8px;">
            <tr>
              <td style="padding:32px 40px;">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#24292f; font-size:14px; line-height:1.6;">
                  <p style="margin:0 0 16px 0;">${greeting}</p>
                  <p style="margin:0 0 16px 0;">${serverIntro}</p>
                  <p style="margin:0 0 16px 0;"><strong>${safeServerName}</strong></p>
                  <p style="margin:0 0 16px 0;">${codeIntro}</p>
                  <p style="margin:0 0 24px 0;">
                    <code style="display:inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:18px; letter-spacing:1px; padding:10px 16px; background:#f6f8fa; color:#24292f; border:1px solid #d0d7de; border-radius:6px;">${safeCode}</code>
                  </p>
                  <p style="margin:0 0 16px 0; color:#57606a;">${ignoreNote}<br />${noReply}</p>
                  <hr style="border:none; border-top:1px solid #d8dee4; margin:24px 0;" />
                  <p style="margin:0; color:#57606a; font-size:12px;">${moreInfo} <a href="https://emailbot.larskaesberg.de/" style="color:#0969da; text-decoration:none;">https://emailbot.larskaesberg.de/</a></p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
    }
}

module.exports = MailTransport
