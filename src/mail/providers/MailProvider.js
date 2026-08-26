// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

module.exports = class MailProvider {
    get name() { return 'unknown' }

    /**
     * @param {{ from: string, fromName: string, to: string, subject: string,
     *          text: string, html?: string, headers?: object }} opts
     * @returns {Promise<{ accepted: string[], rejected: string[],
     *          messageId?: string, response?: string }>}
     */
    async sendMail(opts) {
        throw new Error('MailProvider.sendMail not implemented')
    }
}
