const config = require("../../config/config.json")
const { defaultLanguage, getLocale } = require("../Language")
const database = require("../database/Database")
const { MessageFlags, EmbedBuilder } = require('discord.js')
const ErrorNotifier = require('../utils/ErrorNotifier')
const OperatorWebhook = require('../utils/OperatorWebhook')
const SelfSmtpProvider = require('./providers/SelfSmtpProvider')
const ZeptoMailProvider = require('./providers/ZeptoMailProvider')
const premiumManager = require('../premium/PremiumManager')
const { buildPlanButtons, getWebsiteUrl } = require('../utils/premiumButtons')
const { createMailLimitReachedEmbed } = require('../utils/embeds')

// ZeptoMail outages typically affect every guild at once, so throttle the
// operator-webhook notification to one ping per 24h globally. The console.warn
// still fires on every failure for forensic visibility — only the webhook is
// rate-limited so the operator isn't spammed during a long outage.
const ZEPTO_FALLBACK_WEBHOOK_INTERVAL_MS = 24 * 60 * 60 * 1000

module.exports = class MailSender {
    constructor(serverStatsAPI) {
        this.serverStatsAPI = serverStatsAPI
        this.zeptoFallbackLastWebhookAt = 0

        const username = typeof config.username === 'undefined' ? config.email : config.username
        this.username = username

        this.selfProvider = new SelfSmtpProvider({
            smtpHost: config.smtpHost,
            username,
            password: config.password,
            smtpPort: config.smtpPort,
            isSecure: config.isSecure,
            isGoogle: config.isGoogle
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
     * @param {string} [emailStyle='plain'] - 'plain' | 'styled'
     */
    async sendEmail(toEmail, code, name, interaction, emailNotify, callback, premiumSource = 'free', emailStyle = 'plain') {
        const serverId = interaction.guildId

        await database.getServerSettings(serverId, async (serverSettings) => {
            const language = serverSettings.language || defaultLanguage
            const plainText = getLocale(language, "emailText", name, code)
            const emailSubject = getLocale(language, "emailSubject")
            const emailSenderName = getLocale(language, "emailSenderName")
            const html = emailStyle === 'styled'
                ? this.#buildLocalizedHtmlEmail(language, name, code)
                : null

            const sendOpts = {
                fromName: emailSenderName,
                from: this.username,
                to: toEmail,
                subject: emailSubject,
                text: plainText,
                html,
                headers: {
                    'X-Mailer': 'EmailVerify',
                    'List-Unsubscribe': `<mailto:${this.username}?subject=unsubscribe>`,
                    'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
                }
            }

            const useZepto = this.zeptoProvider && (premiumSource === 'subscription' || premiumSource === 'credits-zepto')
            let info = null
            let usedProvider = null
            let lastError = null

            if (useZepto) {
                try {
                    info = await this.zeptoProvider.sendMail(sendOpts)
                    usedProvider = 'zeptomail'
                } catch (err) {
                    lastError = err
                    console.warn(`[MailSender] ZeptoMail send failed for guild=${interaction.guild?.id ?? 'unknown'} — falling back to self-SMTP:`, err.message)
                    const now = Date.now()
                    if (now - this.zeptoFallbackLastWebhookAt >= ZEPTO_FALLBACK_WEBHOOK_INTERVAL_MS) {
                        this.zeptoFallbackLastWebhookAt = now
                        OperatorWebhook.notify({
                            title: '✉️ ZeptoMail fallback',
                            description: 'A premium mail send failed; falling back to self-SMTP. Verification still completes for the user. This alert is throttled to once per 24h — further fallbacks during this window are logged to stdout only.',
                            fields: [
                                { name: 'Guild', value: interaction.guild?.id ? `\`${interaction.guild.id}\` (${interaction.guild.name})` : 'n/a', inline: false },
                                { name: 'Error', value: `\`${(err?.message || 'unknown').slice(0, 1000)}\``, inline: false }
                            ],
                            level: 'warn'
                        })
                    }
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

            const failed = !info || (info.rejected && info.rejected.length > 0)

            if (failed) {
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
                const errorEmbed = new EmbedBuilder()
                    .setTitle(getLocale(language, "mailFailedTitle"))
                    .setDescription(getLocale(language, "mailFailedDescription", toEmail))
                    .setColor(0xED4245)
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                } else {
                    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                }
                return
            }

            this.serverStatsAPI.increaseMailSend()

            try {
                const crossings = await database.recordMailSentAndCheckThresholds(serverId, premiumSource, this.freeMonthlyLimit)
                this.#fireQuotaWarnings(interaction, language, serverSettings, crossings)
                if (premiumSource === 'credits-zepto' && crossings.creditsRemaining !== null && crossings.creditsRemaining <= 0) {
                    this.#maybeAutoDisableZeptoMode(interaction, language)
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
        })
    }

    async #maybeAutoDisableZeptoMode(interaction, language) {
        const guild = interaction?.guild
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

    async #fireQuotaWarnings(interaction, language, serverSettings, crossings) {
        const guild = interaction?.guild
        if (!guild || !crossings) return

        const anyCrossed = crossings.crossed80 || crossings.crossed95 || crossings.crossed100
            || crossings.crossedCreditsLow || crossings.crossedCreditsZero
        if (!anyCrossed) return

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

        const websiteUrl = getWebsiteUrl()
        const footer = this.#buildQuotaFooter(language, websiteUrl)

        const fire = (titleKey, msgKey, ...vars) => {
            const baseMessage = getLocale(language, msgKey, ...vars)
            ErrorNotifier.notify({
                guild,
                errorTitle: getLocale(language, titleKey),
                errorMessage: footer ? `${baseMessage}\n\n${footer}` : baseMessage,
                language,
                components
            }).catch(() => {})
        }

        if (crossings.crossed80) {
            fire('quotaWarn80Title', 'quotaWarn80Message', String(crossings.mailsSentMonth ?? ''), String(this.freeMonthlyLimit))
        }
        if (crossings.crossed95) {
            fire('quotaWarn95Title', 'quotaWarn95Message', String(crossings.mailsSentMonth ?? ''), String(this.freeMonthlyLimit))
        }
        if (crossings.crossed100) {
            fire('quotaWarn100Title', 'quotaWarn100Message', String(this.freeMonthlyLimit))
        }
        if (crossings.crossedCreditsLow) {
            fire('quotaWarnCreditsLowTitle', 'quotaWarnCreditsLowMessage', String(crossings.creditsRemaining ?? 0))
        }
        if (crossings.crossedCreditsZero) {
            fire('quotaWarnCreditsZeroTitle', 'quotaWarnCreditsZeroMessage')
        }

        // Public-facing service notice in the verify channel: only on quota exhaustion
        // (100% or zero credits), not advisory crossings. This is what regular members
        // see so they can explain to themselves why verification stopped working.
        if (crossings.crossed100 || crossings.crossedCreditsZero) {
            this.#postPublicLimitNotice(interaction, language).catch(() => {})
        }
    }

    #buildQuotaFooter(language, websiteUrl) {
        const hint = getLocale(language, 'quotaWarnFooterHint')
        if (!websiteUrl) return hint
        const website = getLocale(language, 'quotaWarnFooterWebsite', websiteUrl)
        return `${hint}\n${website}`
    }

    async #postPublicLimitNotice(interaction, language) {
        // Post into the channel the user was actively verifying in — that's necessarily
        // the verify channel (or wherever the admin placed the verify button), and the
        // bot just used permissions there for the email modal, so the send should work.
        // We deliberately don't fall back to serverSettings.channelID — that field is
        // legacy reaction-flow state and isn't populated for new /button setups.
        const channel = interaction?.channel
        if (!channel || !channel.isTextBased?.()) return
        try {
            const embed = createMailLimitReachedEmbed(language, getWebsiteUrl())
            await channel.send({ embeds: [embed] })
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

        const greeting = this.#escapeHtml(getLocale(language, 'emailHtmlGreeting'))
        const serverIntro = this.#escapeHtml(getLocale(language, 'emailHtmlServerIntro'))
        const codeIntro = this.#escapeHtml(getLocale(language, 'emailHtmlCodeIntro'))
        const ignoreNote = this.#escapeHtml(getLocale(language, 'emailHtmlIgnoreNote'))
        const noReply = this.#escapeHtml(getLocale(language, 'emailHtmlNoReply'))
        const moreInfo = this.#escapeHtml(getLocale(language, 'emailHtmlMoreInfo'))

        return `<!doctype html>
<html lang="${this.#escapeHtml(language).slice(0, 5)}">
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
