const database = require("../database/Database");
const {getLocale} = require("../Language");
module.exports = async function sendVerifyMessage(guild, user, channelId, messageId, userGuilds, interaction = false) {
    await database.getServerSettings(guild.id, (async serverSettings => {
        if ((channelId !== serverSettings.channelID || messageId !== serverSettings.messageID) && !interaction) {
            return
        }
        if (!serverSettings.status) {
            await user.send(getLocale(serverSettings.language, "userBotError")).catch(() => {
            })
            return
        }
        try {
            if (serverSettings.status) {
                userGuilds.set(user.id, guild)
                if (serverSettings.verifyMessage !== "") {
                    await user.send(serverSettings.verifyMessage).catch(() => {
                    })
                } else {
                    let message = getLocale(serverSettings.language, "userEnterEmail", ("(<name>" + serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "\\*") + ")"))
                    if (serverSettings.logChannel !== "") {
                        message += " Caution: The admin can see the used email address"
                    }
                    await user.send(message).catch(() => {
                    })
                }

            }
        } catch {
            await user.send(getLocale(serverSettings.language, "userRetry"))
        }
    }))
}
