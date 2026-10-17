// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

class ServerSettings {
    constructor() {
        this.domains = []
        this.blacklist = []
        this.channelID = ""
        this.messageID = ""
        this.verifiedRoleName = ""
        this.unverifiedRoleName = ""
        this.autoAddUnverified = 0
        this.autoVerify = 0
        this.language = "english"
        this.verifyMessage = ""
        this.logChannel = ""
        // Legacy error notification settings (kept for read-side migration only)
        this.errorNotifyType = "owner"
        this.errorNotifyTarget = ""
        // Explicit error channel destination; "" falls back to logChannel
        this.errorNotifyChannel = ""
        // Ping mode for the error channel: "none" | "everyone" | "here" | <roleId>
        this.errorNotifyPing = "none"
        // User IDs explicitly opted into error DMs (excludes owner — see errorNotifyOwnerOptedOut)
        this.errorNotifyUsers = []
        // Owner is opted into error DMs by default; this flips to 1 if they run `/set_error_notify me off`
        this.errorNotifyOwnerOptedOut = 0
        // Default roles assigned to all verified users (array of role IDs)
        this.defaultRoles = []
        // Domain-specific roles: { "@domain.com": ["roleId1", "roleId2"], "@*.edu": ["roleId3"] }
        this.domainRoles = {}
        // Allowed email addresses uploaded via CSV (array of lowercase email strings)
        this.allowedEmails = []
        // Email rendering style the admin picked: 'styled' (HTML with a text fallback),
        // 'plain' (text only), or null for the default. Only an explicit pick is stored,
        // so servers that never chose follow the default if it changes again.
        this.emailStyle = null
    }

    /** The style verification emails are sent in: the admin's pick, else styled. */
    get effectiveEmailStyle() {
        return this.emailStyle === 'plain' ? 'plain' : 'styled'
    }

    get status() {
        // Bot is configured if at least one role is configured.
        // Empty domains + empty allowedEmails = "accept any email" (default-open),
        // so the email source no longer needs to be explicitly set.
        const hasRoles = this.defaultRoles.length > 0 ||
                         Object.keys(this.domainRoles).length > 0 ||
                         this.verifiedRoleName !== "" // Legacy support
        return hasRoles
    }
}

module.exports = ServerSettings