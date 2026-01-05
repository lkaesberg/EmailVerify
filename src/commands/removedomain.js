const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const registerRemoveDomain = require("../bot/registerRemoveDomain")
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('removedomain').setDescription('remove registered domain').addStringOption(option => option.setName('removedomains').setDescription('remove registered domain (remove multiple domains separated by \',\')').setRequired(true)).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const removeDomains = interaction.options.getString('removedomains', true).split(",");

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const deletedDomains = serverSettings.domains.filter((domain) => removeDomains.includes(domain))
            serverSettings.domains = serverSettings.domains.filter((domain) => !removeDomains.includes(domain));
            if (deletedDomains.length === 0){
                await interaction.reply({content: "Removed no domains", flags: MessageFlags.Ephemeral})
            }else{
                await interaction.reply({content: "Removed " + deletedDomains.toString(), flags: MessageFlags.Ephemeral})
            }
            database.updateServerSettings(interaction.guildId, serverSettings)
            await registerRemoveDomain(interaction.guildId, {data: this.data})
        })
    }
}