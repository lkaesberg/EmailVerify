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
            
            // Use localized email text from language files
            // getLocale handles %VAR% replacement: first = server name, second = verification code
            const plainText = getLocale(language, "emailText", name, code);
            const emailSubject = getLocale(language, "emailSubject");
            const emailSenderName = getLocale(language, "emailSenderName");

            const mailOptions = {
                from: `"${emailSenderName}" <${username}>`,  // MUST match authenticated user for DMARC/SPF alignment
                to: toEmail,
                subject: emailSubject,
                text: plainText,
                // No HTML - plain text only for maximum deliverability
                headers: {
                    'X-Mailer': 'EmailVerify',
                    'List-Unsubscribe': `<mailto:${username}?subject=unsubscribe>`,
                    'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
                }
            };
            
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

    /**
     * Build system-like HTML email that matches plain text exactly.
     * Designed to look like transactional/notification mail (GitHub, GitLab style).
     * Avoids: bold "verification", red colors, warning icons, exclamation marks, countdown/expiration.
     */
    #buildSystemHtmlEmail(serverName, code) {
        const safeServerName = this.#escapeHtml(serverName || '')
        const safeCode = this.#escapeHtml(code || '')

        return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>EmailVerify notification</title>
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
                  <p style="margin:0 0 16px 0;">Hello,</p>
                  <p style="margin:0 0 16px 0;">This message was generated by EmailVerify for the Discord server:</p>
                  <p style="margin:0 0 16px 0;">${safeServerName}</p>
                  <p style="margin:0 0 16px 0;">To continue, enter the following value in Discord:</p>
                  <p style="margin:0 0 24px 0;">
                    <code style="display:inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:18px; letter-spacing:1px; padding:10px 16px; background:#f6f8fa; color:#24292f; border:1px solid #d0d7de; border-radius:6px;">${safeCode}</code>
                  </p>
                  <p style="margin:0 0 16px 0; color:#57606a;">If you did not request this message, you can ignore it.<br />No reply is required.</p>
                  <hr style="border:none; border-top:1px solid #d8dee4; margin:24px 0;" />
                  <p style="margin:0; color:#57606a; font-size:12px;">More information: <a href="https://emailbot.larskaesberg.de/" style="color:#0969da; text-decoration:none;">https://emailbot.larskaesberg.de/</a></p>
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
