let {smtpHost, email, username, password, isGoogle, isSecure, smtpPort} = require("../../config/config.json");

const nodemailer = require("nodemailer");
const smtpTransport = require("nodemailer-smtp-transport");
const {defaultLanguage, getLocale} = require("../Language");
const database = require("../database/Database");
const { MessageFlags } = require('discord.js');

if (typeof username === 'undefined') {
    username = email;
}

module.exports = class MailSender {
    constructor(userGuilds, serverStatsAPI) {
        this.userGuilds = userGuilds
        this.serverStatsAPI = serverStatsAPI
        let nodemailerOptions = {
            host: smtpHost,
            auth: {
                user: username,
                pass: password
            },
            tls: {
              rejectUnauthorized: false
            }
        }
        if (isGoogle) nodemailerOptions["service"] = "gmail"
        if (isSecure) nodemailerOptions["secure"] = isSecure
        if (smtpPort) nodemailerOptions["port"] = smtpPort


        this.transporter = nodemailer.createTransport(smtpTransport(nodemailerOptions));
    }

    async sendEmail(toEmail, code, name, message, emailNotify, callback, options = {}) {
        // message can be a DM Message or an Interaction (from modals/buttons)
        const isGuildInteraction = typeof message.guildId !== 'undefined' && message.guildId !== null;
        const userId = message.user ? message.user.id : message.author.id;
        const serverId = isGuildInteraction ? message.guildId : this.userGuilds.get(userId).id;

        await database.getServerSettings(serverId, serverSettings => {
            const mailOptions = {
                from: '"Email Verification Bot ✉️" <'+ email +'>',
                to: toEmail,
                subject: name + ' Discord Email Verification',
                text: getLocale(serverSettings.language, "emailText", name, code),
                headers: {
                    'X-Mailer': 'Discord Email Verification Bot',
                    'X-Priority': '1',
                    'X-MSMail-Priority': 'High',
                    'Importance': 'high',
                    'List-Unsubscribe': '<mailto:' + email + '?subject=unsubscribe>',
                    'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply'
                }
            };

            if (!isGoogle) mailOptions["bcc"] = email

            let language = ""
            try {
                language = serverSettings.language
            } catch {
                language = defaultLanguage
            }
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
                    if (!options.suppressReply) {
                        const negative = getLocale(language, "mailNegative", toEmail)
                        if (isGuildInteraction) {
                            if (message.deferred || message.replied) {
                                await message.followUp({ content: negative, flags: MessageFlags.Ephemeral }).catch(() => {})
                            } else {
                                await message.reply({ content: negative, flags: MessageFlags.Ephemeral }).catch(() => {})
                            }
                        } else {
                            await message.reply(negative).catch(() => {})
                        }
                    }
                } else {
                    this.serverStatsAPI.increaseMailSend()
                    callback(info.accepted[0])
                    if (!options.suppressReply) {
                        const positive = getLocale(language, "mailPositive", toEmail)
                        if (isGuildInteraction) {
                            if (message.deferred || message.replied) {
                                await message.followUp({ content: positive, flags: MessageFlags.Ephemeral }).catch(() => {})
                            } else {
                                await message.reply({ content: positive, flags: MessageFlags.Ephemeral }).catch(() => {})
                            }
                        } else {
                            await message.reply(positive).catch(() => {})
                        }
                    }
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
}
