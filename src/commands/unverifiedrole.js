const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('unverifiedrole').setDescription('returns the name of the unverified role')
        .addRoleOption(option => option.setName('unverifiedrole').setDescription('set the role name for the unverified role ( (current unverified role) -> deactivate unverified role)')).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const unverifiedRole = interaction.options.getRole('unverifiedrole');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (unverifiedRole == null) {
                let role = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName)
                if (role === undefined) {
                    await interaction.reply({content: "Unverified role is disabled", flags: MessageFlags.Ephemeral})
                    return
                }
                await interaction.reply({content: "Unverified role: " + role.name, flags: MessageFlags.Ephemeral})
            } else {
                if (unverifiedRole.id === serverSettings.unverifiedRoleName) {
                    serverSettings.unverifiedRoleName = ""
                    await interaction.reply({content: "Unverified role deactivated", flags: MessageFlags.Ephemeral})
                } else {
                    if (unverifiedRole.name === "@everyone") {
                        await interaction.reply({content: "@Everyone is no permitted role!", flags: MessageFlags.Ephemeral})
                        return
                    }
                    serverSettings.unverifiedRoleName = unverifiedRole.id
                    await interaction.reply({content: "Unverified role changed to " + unverifiedRole.name, flags: MessageFlags.Ephemeral})
                }

                database.updateServerSettings(interaction.guildId, serverSettings)
            }
        })
    }
}