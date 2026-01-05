const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('verifiedrole').setDescription('returns the name of the verified role').addRoleOption(option => option.setName('verifiedrole').setDescription('set the role name for the verified role')).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const verifiedRole = interaction.options.getRole('verifiedrole');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (verifiedRole == null) {
                let role = interaction.guild.roles.cache.find(r => r.id === serverSettings.verifiedRoleName)
                if (role === undefined) {
                    await interaction.reply({content: "Verified role can not be found!", flags: MessageFlags.Ephemeral})
                    return
                }
                await interaction.reply({content: "Verified role: " + role.name, flags: MessageFlags.Ephemeral})
            } else {
                if (verifiedRole.name === "@everyone") {
                    await interaction.reply({content: "@Everyone is no permitted role!", flags: MessageFlags.Ephemeral})
                    return
                }
                serverSettings.verifiedRoleName = verifiedRole.id
                await interaction.reply({content: "Verified role changed to " + verifiedRole.name, flags: MessageFlags.Ephemeral})
                database.updateServerSettings(interaction.guildId, serverSettings)
            }
        })

    }
}