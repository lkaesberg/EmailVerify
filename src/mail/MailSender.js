// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const config = require("../../config/config.json")
const { defaultLanguage } = require("../Language")
const database = require("../database/Database")
const MailTransport = require('../core/MailTransport')
const analytics = require('../utils/Analytics')

// Discord's entry point to mail sending: the boot-time SMTP self-test and
// `/testmail`. Verification sends go through core/VerificationService, and delivery
// itself through core/MailTransport, which both platforms share.

module.exports = class MailSender {
    constructor(serverStatsAPI) {
        this.serverStatsAPI = serverStatsAPI
        this.transport = new MailTransport({ serverStatsAPI })
        this.fromAddress = this.transport.fromAddress
        this.freeMonthlyLimit = config.monetization?.freeMonthlyLimit ?? 25
    }

    async selfTest() {
        return this.transport.selfTest()
    }

    /**
     * Send a test verification email through the normal provider path (same template,
     * same provider selection and fallback as real sends — that's the point of the
     * test). The caller must have admitted the send via premiumManager.canSendMail
     * and passes its `source`; on delivery failure a consumed credit is refunded.
     * Counts against the guild's monthly counters (no threshold warnings fired —
     * flags stay untripped, so the next real send still warns).
     *
     * @returns {Promise<{ok: boolean, provider?: string, messageId?: string, latencyMs?: number, error?: string}>}
     */
    async sendTestEmail({ toEmail, guildId, guildName, language, emailStyle, premiumSource }) {
        const result = await this.transport.send({
            toEmail,
            code: require('crypto').randomInt(100000, 1000000).toString(),
            communityName: guildName,
            guildID: guildId,
            language: language || defaultLanguage,
            emailStyle,
            premiumSource,
            guildLabel: guildName
        })

        if (!result.ok) {
            return { ok: false, error: result.error }
        }

        database.incrementMailsSent(guildId)
        analytics.capture({
            event: 'mail_sent',
            guildId,
            properties: { provider: result.provider, source: premiumSource, email_style: emailStyle, test: true }
        })
        return { ok: true, provider: result.provider, messageId: result.messageId, latencyMs: result.latencyMs }
    }
}
