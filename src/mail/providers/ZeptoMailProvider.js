// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const https = require('https')
const { URL } = require('url')
const MailProvider = require('./MailProvider')

// ZeptoMail answers HTTP 401 / TM_4001 "Access Denied" for a broad range of
// rejections, including ones that have nothing to do with the API token — a
// recipient the address validator dislikes comes back as a 401 too. The real
// cause sits in `error.details`: an entry whose `target` names the recipient
// fields ("to|cc|bcc") or whose inner error is SMI_116 ("No valid recipients
// found") means the user's address was rejected, not our credentials. Callers
// need that apart from a genuine outage — retrying such a send on another
// transport can only fail the same way.
const RECIPIENT_TARGET = /(^|\|)\s*(to|cc|bcc)\s*(\||$)/i

function isInvalidRecipientBody(body) {
    let parsed
    try { parsed = JSON.parse(body) } catch (e) { return false }
    const details = parsed?.error?.details
    if (!Array.isArray(details)) return false
    return details.some(d =>
        (typeof d?.target === 'string' && RECIPIENT_TARGET.test(d.target))
        || d?.inner_error?.code === 'SMI_116'
    )
}

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
                        // Only a 4xx can be a rejected recipient; a 5xx is the service
                        // failing regardless of what we sent it.
                        err.invalidRecipient = res.statusCode >= 400 && res.statusCode < 500
                            && isInvalidRecipientBody(data)
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
