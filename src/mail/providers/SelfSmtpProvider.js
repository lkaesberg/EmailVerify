const nodemailer = require('nodemailer')
const MailProvider = require('./MailProvider')

module.exports = class SelfSmtpProvider extends MailProvider {
    constructor({ smtpHost, username, password, smtpPort, isSecure, isGoogle, fromAddress }) {
        super()
        this.username = username
        // The SMTP username is not always a mailbox. Relays such as Resend, SendGrid
        // and SES authenticate with a fixed token ("resend", "apikey", an access key
        // id), so using it as the sender makes the MAIL FROM invalid and the relay
        // answers "501 Bad sender address syntax". Fall back to the username only for
        // the classic setup where the login is the address it sends from.
        this.fromAddress = fromAddress || username

        if (isGoogle) {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: username, pass: password }
            })
        } else {
            this.transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort || 587,
                secure: isSecure || false,
                name: smtpHost,
                auth: { user: username, pass: password },
                tls: { rejectUnauthorized: true }
            })
        }
    }

    get name() { return 'self-smtp' }

    /** Verify SMTP connectivity/credentials without sending a mail (nodemailer verify). */
    verify() {
        return new Promise((resolve, reject) => {
            this.transporter.verify((error) => {
                if (error) return reject(error)
                resolve(true)
            })
        })
    }

    sendMail({ fromName, to, subject, text, html, headers }) {
        const mailOptions = {
            from: `"${fromName}" <${this.fromAddress}>`,
            to,
            subject,
            text,
            headers
        }
        if (html) mailOptions.html = html

        return new Promise((resolve, reject) => {
            this.transporter.sendMail(mailOptions, (error, info) => {
                if (error) return reject(error)
                resolve({
                    accepted: info.accepted || [],
                    rejected: info.rejected || [],
                    messageId: info.messageId,
                    response: info.response
                })
            })
        })
    }
}
