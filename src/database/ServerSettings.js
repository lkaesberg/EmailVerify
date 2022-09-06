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
    }

    get status() {
        return this.domains.length !== 0 && this.verifiedRoleName !== ""
    }
}

module.exports = ServerSettings