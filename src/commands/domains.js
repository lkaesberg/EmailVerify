const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const registerRemoveDomain = require("../bot/registerRemoveDomain")
const { MessageFlags } = require('discord.js');


module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('domains').setDescription('returns registered domains').addStringOption(option => option.setName('domain').setDescription('register given domain (use * as wildcard) (add multiple domains separated by \',\')')).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const domains = interaction.options.getString('domain');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (domains === null) {
                await interaction.reply({content: "Allowed domains: " + serverSettings.domains.toString().replaceAll("*", "\\*"), flags: MessageFlags.Ephemeral})
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
                    await interaction.reply({content: "Added " + addedDomains.toString().replaceAll("*", "\\*"), flags: MessageFlags.Ephemeral})
                    database.updateServerSettings(interaction.guildId, serverSettings)
                    await registerRemoveDomain(interaction.guildId)
                } else {
                    await interaction.reply({content: "Please enter a valid domain", flags: MessageFlags.Ephemeral})
                }

            }
        })

    }
}
