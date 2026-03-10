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
        // Error notification settings: 'owner' (default), 'user', or 'channel'
        this.errorNotifyType = "owner"
        // The user ID or channel ID for error notifications (empty means use owner)
        this.errorNotifyTarget = ""
        // Default roles assigned to all verified users (array of role IDs)
        this.defaultRoles = []
        // Domain-specific roles: { "@domain.com": ["roleId1", "roleId2"], "@*.edu": ["roleId3"] }
        this.domainRoles = {}
        // Allowed email addresses uploaded via CSV (array of lowercase email strings)
        this.allowedEmails = []
    }

    get status() {
        // Bot is configured if (domains exist OR allowedEmails exist) AND at least one role is configured
        const hasRoles = this.defaultRoles.length > 0 || 
                         Object.keys(this.domainRoles).length > 0 || 
                         this.verifiedRoleName !== "" // Legacy support
        const hasEmailSource = this.domains.length !== 0 || this.allowedEmails.length !== 0
        return hasEmailSource && hasRoles
    }
}

module.exports = ServerSettings