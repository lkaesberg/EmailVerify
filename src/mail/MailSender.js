const config = require("../../config/config.json")
const { defaultLanguage, getLocale } = require("../Language")
const database = require("../database/Database")
const { MessageFlags, EmbedBuilder } = require('discord.js')
const ErrorNotifier = require('../utils/ErrorNotifier')
const SelfSmtpProvider = require('./providers/SelfSmtpProvider')
const ZeptoMailProvider = require('./providers/ZeptoMailProvider')

module.exports = class MailSender {
    constructor(serverStatsAPI) {
        this.serverStatsAPI = serverStatsAPI

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

            const useZepto = this.zeptoProvider && premiumSource === 'subscription'
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
                if (premiumSource === 'credits') {
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
                this.#fireQuotaWarnings(interaction.guild, language, crossings)
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

    #fireQuotaWarnings(guild, language, crossings) {
        if (!guild || !crossings) return

        const fire = (titleKey, msgKey, ...vars) => {
            ErrorNotifier.notify({
                guild,
                errorTitle: getLocale(language, titleKey),
                errorMessage: getLocale(language, msgKey, ...vars),
                language
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
