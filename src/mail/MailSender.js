let {smtpHost, email, username, password, isGoogle, isSecure, smtpPort} = require("../../config/config.json");

const nodemailer = require("nodemailer");
const {defaultLanguage, getLocale} = require("../Language");
const database = require("../database/Database");
const { MessageFlags, EmbedBuilder } = require('discord.js');

// Ensure username is set (used for SMTP auth AND From address for policy compliance)
if (typeof username === 'undefined') {
    username = email;
}

module.exports = class MailSender {
    constructor(serverStatsAPI) {
        this.serverStatsAPI = serverStatsAPI
        
        let nodemailerOptions = {
            host: smtpHost,
            port: smtpPort || 587,           // Default to STARTTLS port
            secure: isSecure || false,        // false = STARTTLS on 587, true = implicit TLS on 465
            name: smtpHost,
            auth: {
                user: username,
                pass: password
            },
            tls: {
                rejectUnauthorized: true      // Enforce TLS certificate verification (required by many university mail servers)
            }
        }
        
        // Gmail uses its own service configuration
        if (isGoogle) {
          this.transporter = nodemailer.createTransport({
              service: 'gmail',
              auth: {
                  user: username,
                  pass: password
              }
          });
      } else {
          this.transporter = nodemailer.createTransport(nodemailerOptions);
      }
    }

    /**
     * Send verification email
     * @param {string} toEmail - Email address to send to
     * @param {string} code - Verification code
     * @param {string} name - Server name
     * @param {Interaction} interaction - Discord interaction (modal/button)
     * @param {boolean} emailNotify - Whether to log email events to console
     * @param {Function} callback - Called with accepted email on success
     */
    async sendEmail(toEmail, code, name, interaction, emailNotify, callback) {
        const serverId = interaction.guildId;

        await database.getServerSettings(serverId, serverSettings => {
            const language = serverSettings.language || defaultLanguage;
            
            const mailOptions = {
                from: `"Email Verification Bot ✉️" <${username}>`,  // MUST match authenticated user for DMARC/SPF alignment
                to: toEmail,
                subject: '[EmailVerify] Your Discord verification code for ' + name,
                text: getLocale(language, "emailText", name, code),
                headers: {
                    'X-Mailer': 'Discord Email Verification Bot',
                    'X-Priority': '1',
                    'X-MSMail-Priority': 'High',
                    'Importance': 'high',
                    'List-Unsubscribe': `<mailto:${username}?subject=unsubscribe>`,
                    'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
                }
            };

            // Build modern HTML version while preserving the same text content
            const websiteUrl = 'https://emailbot.larskaesberg.de/'
            const emailTextBase = getLocale(language, "emailText", name, code)
            const emailText = emailTextBase + "\n\n" + 'Learn more: ' + websiteUrl
            mailOptions.text = emailText
            mailOptions.html = this.#buildModernHtmlEmail(emailTextBase, name, code)
            
            this.transporter.sendMail(mailOptions, async (error, info) => {
                if (error || info.rejected.length > 0) {
                    if (emailNotify) {
                        console.log('EMAIL ERROR for:', toEmail);
                        console.log('Error details:', error);
                        if (info && info.rejected.length > 0) {
                            console.log('Rejected emails:', info.rejected);
                        }
                        if (info && info.response) {
                            console.log('SMTP Response:', info.response);
                        }
                    }
                    // Show error message to the user
                    const errorEmbed = new EmbedBuilder()
                        .setTitle(getLocale(language, "mailFailedTitle"))
                        .setDescription(getLocale(language, "mailFailedDescription", toEmail))
                        .setColor(0xED4245)
                    
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                    } else {
                        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {})
                    }
                } else {
                    this.serverStatsAPI.increaseMailSend()
                    database.incrementMailsSent(serverId)
                    callback(info.accepted[0])
                    if (emailNotify) {
                        console.log('EMAIL SUCCESS for:', toEmail);
                        console.log('Accepted emails:', info.accepted);
                        console.log('Message ID:', info.messageId);
                        console.log('SMTP Response:', info.response);
                    }
                }
            });
        })
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

    #buildModernHtmlEmail(emailText, serverName, code) {
        const safeText = this.#escapeHtml(emailText || '')
        const safeServerName = this.#escapeHtml(serverName || '')
        const safeCode = this.#escapeHtml(code || '')

        // Convert plain text into paragraphs, preserving the exact wording
        const paragraphs = safeText
            .split(/\n+/)
            .filter(p => p.trim().length > 0)
            .map(p => `<p style="margin:0 0 16px 0; color:#3f3f46; font-size:16px; line-height:24px;">${p}</p>`) // Tailwind-like spacing
            .join('')

        // Emphasize the code visually without changing the text itself
        const highlightedCode = `<div style="margin-top:12px; margin-bottom:4px;">
  <code style="display:inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size:22px; letter-spacing:2px; padding:12px 16px; background:#0f172a; color:#e2e8f0; border-radius:10px;">${safeCode}</code>
</div>`

        // If the last paragraph already includes the code text, we still render the visual block below for modern layout
        const content = `${paragraphs}${highlightedCode}`

        return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Email Verification</title>
    <style>
      /* Prevent auto-linking of numbers on iOS */
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    </style>
  </head>
  <body style="margin:0; padding:0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; background:#f4f4f4; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(15,23,42,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,#6366f1,#22d3ee); padding:20px 24px;">
                <div style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'; color:#ffffff;">
                  <div style="font-weight:700; font-size:18px; line-height:24px;">Email Verification</div>
                  <div style="opacity:0.9; font-size:14px;">${safeServerName ? 'for ' + safeServerName : ''}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <div style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji';">
                  ${content}
                  <div style="height:12px;"></div>
                  <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;" />
                  <p style="margin:0; color:#6b7280; font-size:12px; line-height:18px;">This email was sent by Discord Email Verification Bot. Learn more at <a href="https://emailbot.larskaesberg.de/" style="color:#2563eb; text-decoration:underline;">emailbot.larskaesberg.de</a>.</p>
                </div>
              </td>
            </tr>
          </table>
          <div style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial; color:#9ca3af; font-size:12px; margin-top:12px;">If you didn't request this, you can ignore this email.</div>
        </td>
      </tr>
    </table>
  </body>
</html>`
    }
}
