const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const registerRemoveDomain = require("../bot/registerRemoveDomain")

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('removedomain').setDescription('remove registered domain').addStringOption(option => option.setName('removedomains').setDescription('remove registered domain (remove multiple domains separated by \',\')').setRequired(true)).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const removeDomains = interaction.options.getString('removedomains', true).split(",");

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const deletedDomains = serverSettings.domains.filter((domain) => removeDomains.includes(domain))
            serverSettings.domains = serverSettings.domains.filter((domain) => !removeDomains.includes(domain));
            if (deletedDomains.length === 0){
                await interaction.reply("Removed no domains")
            }else{
                await interaction.reply("Removed " + deletedDomains.toString())
            }
            database.updateServerSettings(interaction.guildId, serverSettings)
            await registerRemoveDomain(interaction.guildId, {data: this.data})
        })
    }
}