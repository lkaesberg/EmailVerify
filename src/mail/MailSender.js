let {smtpHost, email, username, password, isGoogle, isSecure, smtpPort} = require("../../config.json");

const nodemailer = require("nodemailer");
const smtpTransport = require("nodemailer-smtp-transport");
const {defaultLanguage, getLocale} = require("../Language");
const database = require("../database/Database");

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
            }
        }
        if (isGoogle) nodemailerOptions["service"] = "gmail"
        if (isSecure) nodemailerOptions["secure"] = isSecure
        if (smtpPort) nodemailerOptions["port"] = smtpPort


        this.transporter = nodemailer.createTransport(smtpTransport(nodemailerOptions));
    }

    async sendEmail(toEmail, code, name, message, emailNotify, callback) {
        await database.getServerSettings(this.userGuilds.get(message.author.id).id, serverSettings => {
            const mailOptions = {
                from: '"Email Verification Bot ✉️" <'+ email +'>',
                to: toEmail,
                subject: name + ' Discord Email Verification',
                text: getLocale(serverSettings.language, "emailText", name, code)
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
                        console.log(error);
                    }
                    await message.reply(getLocale(language, "mailNegative", toEmail))
                } else {
                    this.serverStatsAPI.increaseMailSend()
                    callback(info.accepted[0])
                    await message.reply(getLocale(language, "mailPositive", toEmail))
                    if (emailNotify) {
                        console.log('Email sent to: ' + toEmail + ", Info: " + info.response);
                    }
                }
            });
        })
    }
}
