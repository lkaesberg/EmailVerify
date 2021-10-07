class ServerSetting{
    constructor(){
        this.domains = []
        this.channelID = ""
        this.messageID = ""
        this.verifiedRoleName = ""
        this.unverifiedRoleName = ""
    }
    get status(){
        return this.domains.length !== 0 && this.channelID !== "" && this.messageID !== "" && this.verifiedRoleName !== ""
    }
}
module.exports = ServerSetting