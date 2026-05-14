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
        // Email rendering style: 'plain' (default, deliverability-optimized text) or 'styled' (HTML)
        this.emailStyle = "plain"
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