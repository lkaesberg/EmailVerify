const database = require("../database/Database");
const {getLocale} = require("../Language");
const {ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder} = require('discord.js');

module.exports = async function sendVerifyMessage(guild, user, channelId, messageId, userGuilds, interaction = false) {
    await database.getServerSettings(guild.id, (async serverSettings => {
        if ((channelId !== serverSettings.channelID || messageId !== serverSettings.messageID) && !interaction) {
            return
        }
        if (!serverSettings.status) {
            try { await user.send(getLocale(serverSettings.language, "userBotError")) } catch {}
            return
        }
        try {
            if (serverSettings.status) {
                userGuilds.set(user.id, guild)
                // Prefer modal-driven flow; keep DM as fallback
                try {
                    // Restore original DM-based flow for reactions
                    const {getLocale} = require("../Language");
                    let message = serverSettings.verifyMessage !== "" ? serverSettings.verifyMessage : getLocale(serverSettings.language, "userEnterEmail", ("(<name>" + serverSettings.domains.toString().replaceAll(",", "|").replaceAll("*", "\\*") + ")"))
                    if (serverSettings.logChannel !== "") {
                        message += " Attention : L'admin peut voir l'adresse email utilisée"
                    }
                    await user.send(message).catch(() => {})
                } catch {}
            }
        } catch {
            try { await user.send(getLocale(serverSettings.language, "userRetry")) } catch {}
        }
    }))
}
