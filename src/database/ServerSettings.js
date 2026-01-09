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
    }

    get status() {
        return this.domains.length !== 0 && this.verifiedRoleName !== ""
    }
}

module.exports = ServerSettings