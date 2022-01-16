class EmailUser {
    constructor(email, userID, guildID, groupID, isPublic) {
        this.email = email
        this.userID = userID
        this.guildID = guildID
        this.groupID = groupID
        this.isPublic = isPublic
    }
}

module.exports = EmailUser