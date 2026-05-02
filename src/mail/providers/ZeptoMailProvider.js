const https = require('https')
const { URL } = require('url')
const MailProvider = require('./MailProvider')

module.exports = class ZeptoMailProvider extends MailProvider {
    constructor({ apiToken, endpoint, fromAddress, fromName }) {
        super()
        if (!apiToken) throw new Error('ZeptoMail apiToken is required')
        if (!endpoint) throw new Error('ZeptoMail endpoint is required')
        if (!fromAddress) throw new Error('ZeptoMail fromAddress is required')

        this.apiToken = apiToken
        this.endpoint = endpoint
        this.fromAddress = fromAddress
        this.defaultFromName = fromName || 'EmailVerify'
    }

    get name() { return 'zeptomail' }

    sendMail({ fromName, to, subject, text, html }) {
        const body = {
            from: { address: this.fromAddress, name: fromName || this.defaultFromName },
            to: [{ email_address: { address: to } }],
            subject,
            textbody: text
        }
        if (html) body.htmlbody = html

        const payload = JSON.stringify(body)
        const url = new URL(this.endpoint)

        const options = {
            method: 'POST',
            hostname: url.hostname,
            path: url.pathname + url.search,
            port: url.port || 443,
            headers: {
                'Authorization': this.apiToken.startsWith('Zoho-enczapikey ')
                    ? this.apiToken
                    : `Zoho-enczapikey ${this.apiToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = ''
                res.on('data', chunk => { data += chunk })
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        let parsed = {}
                        try { parsed = JSON.parse(data) } catch (e) { /* empty body OK */ }
                        const messageId = parsed?.data?.[0]?.message_id
                        const additional = parsed?.data?.[0]?.additional_info
                        const hardReject = Array.isArray(additional)
                            && additional.some(a => a?.message === 'not_added' || a?.status === 'error')
                        if (hardReject) {
                            return resolve({
                                accepted: [],
                                rejected: [to],
                                messageId,
                                response: data
                            })
                        }
                        resolve({
                            accepted: [to],
                            rejected: [],
                            messageId,
                            response: data
                        })
                    } else {
                        const err = new Error(`ZeptoMail HTTP ${res.statusCode}: ${data}`)
                        err.statusCode = res.statusCode
                        err.body = data
                        reject(err)
                    }
                })
            })
            req.on('error', reject)
            req.write(payload)
            req.end()
        })
    }
}
