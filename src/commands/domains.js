const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");


module.exports = {
    data: new SlashCommandBuilder().setName('domains').setDescription('returns registered domains').addStringOption(option => option.setName('domain').setDescription('register given domain (add multiple domains separated by \',\')')),
    async execute(interaction) {
        const domains = interaction.options.getString('domain');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (domains === null) {
                await interaction.reply("Allowed domains: " + serverSettings.domains.toString())
            } else {
                let addedDomains = []
                domains.split(",").forEach(domain => {
                    if (domain.startsWith("@") && domain.includes(".")) {
                        serverSettings.domains.push(domain)
                        addedDomains.push(domain)
                    } else if (!domain.includes("@") && domain.includes(".")) {
                        serverSettings.domains.push("@" + domain)
                        addedDomains.push("@" + domain)
                    }
                })
                if (addedDomains.length !== 0) {
                    await interaction.reply("Added " + addedDomains.toString())
                    database.updateServerSettings(interaction.guildId, serverSettings)
                } else {
                    await interaction.reply("Please enter a valid domain")
                }

            }
        })

    }
}