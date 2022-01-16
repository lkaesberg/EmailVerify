class ServerSettings {
    constructor() {
        this.domains = []
        this.channelID = ""
        this.messageID = ""
        this.verifiedRoleName = ""
        this.unverifiedRoleName = ""
        this.language = "english"
    }

    get status() {
        return this.domains.length !== 0 && this.channelID !== "" && this.messageID !== "" && this.verifiedRoleName !== ""
    }
}

module.exports = ServerSettings