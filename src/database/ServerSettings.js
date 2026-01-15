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
    }

    get status() {
        // Bot is configured if domains exist AND at least one role is configured (default or domain-specific)
        const hasRoles = this.defaultRoles.length > 0 || 
                         Object.keys(this.domainRoles).length > 0 || 
                         this.verifiedRoleName !== "" // Legacy support
        return this.domains.length !== 0 && hasRoles
    }
}

module.exports = ServerSettings