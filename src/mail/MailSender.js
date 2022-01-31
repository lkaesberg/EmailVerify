const {smtpHost, email, password, isGoogle, isSecure, smtpPort} = require("../../config.json");
const nodemailer = require("nodemailer");
const smtpTransport = require("nodemailer-smtp-transport");
const {defaultLanguage, getLocale} = require("../Language");

module.exports = class MailSender {
    constructor(serverSettingsMap, userGuilds, serverStatsAPI) {
        this.serverSettingsMap = serverSettingsMap
        this.userGuilds = userGuilds
        this.serverStatsAPI = serverStatsAPI
        let nodemailerOptions = {
            host: smtpHost,
            auth: {
                user: email,
                pass: password
            }
        }
        if (isGoogle) nodemailerOptions["service"] = "gmail"
        if (isSecure) nodemailerOptions["secure"] = isSecure
        if (smtpPort) nodemailerOptions["port"] = smtpPort


        this.transporter = nodemailer.createTransport(smtpTransport(nodemailerOptions));
    }

    sendEmail(toEmail, code, name, message, emailNotify, callback) {
        const mailOptions = {
            from: email,
            to: toEmail,
            bcc: email,
            subject: name + ' Discord Password',
            text: code
        };

        let language = ""
        try {
            language = this.serverSettingsMap.get(this.userGuilds.get(message.author.id).id).language
        } catch {
            language = defaultLanguage
        }
        this.transporter.sendMail(mailOptions, async (error, info) => {
            if (error || info.rejected.length > 0) {
                console.log(error);
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
    }
}