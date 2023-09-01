const database = require("../database/Database");
const rest = require("../api/DiscordRest");
const {Routes} = require("discord-api-types/v9");
const {clientId} = require("../../config/config.json");

module.exports = async function registerRemoveDomain(guildId, removeDomain = require("../commands/removedomain")) {
    await database.getServerSettings(guildId, async serverSettings => {
        rest.get(Routes.applicationGuildCommands(clientId, guildId)).then(async commands => {
            const commandId = commands.find(command => command.name === "removedomain")?.id

            if (!commandId) return

            let removeDomainCommand = removeDomain.data.toJSON()


            if (serverSettings.domains.length < 25) {
                removeDomainCommand["options"][0]["choices"] = serverSettings.domains.map(domain => {
                    return {"name": domain, "value": domain}
                })
            } else {
                removeDomainCommand["options"][0]["choices"] = undefined
            }

            rest.patch(Routes.applicationGuildCommand(clientId, guildId, commandId), {body: removeDomainCommand}).catch()
        }).catch(e => console.log(e))
    }).catch(e => console.log(e))
}