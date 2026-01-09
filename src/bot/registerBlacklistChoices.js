const database = require("../database/Database");
const rest = require("../api/DiscordRest");
const {Routes} = require("discord-api-types/v9");
const {clientId} = require("../../config/config.json");

function truncateString(str) {
    if (str.length > 100) {
        return str.substring(0, 96) + '...';
    }
    return str;
}

module.exports = async function registerBlacklistChoices(guildId, blacklistCommand = require("../commands/blacklist")) {
    await database.getServerSettings(guildId, async serverSettings => {
        rest.get(Routes.applicationGuildCommands(clientId, guildId)).then(async commands => {
            const command = commands.find(cmd => cmd.name === "blacklist")
            const commandId = command?.id

            if (!commandId) return

            let blacklistCommandData = blacklistCommand.data.toJSON()

            // Find the 'remove' subcommand and update its choices
            const removeSubcommand = blacklistCommandData.options.find(opt => opt.name === "remove")
            if (removeSubcommand && removeSubcommand.options) {
                const emailsOption = removeSubcommand.options.find(opt => opt.name === "emails")
                if (emailsOption) {
                    if (serverSettings.blacklist.length > 0 && serverSettings.blacklist.length <= 25) {
                        emailsOption.choices = serverSettings.blacklist.map(entry => {
                            return {"name": truncateString(entry), "value": truncateString(entry)}
                        })
                    } else {
                        emailsOption.choices = undefined
                    }
                }
            }

            rest.patch(Routes.applicationGuildCommand(clientId, guildId, commandId), {body: blacklistCommandData}).catch()
        }).catch(e => console.log(e))
    }).catch(e => console.log(e))
}
