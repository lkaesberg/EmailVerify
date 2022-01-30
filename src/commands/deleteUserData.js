const database = require("../database/Database.js");
const {SlashCommandBuilder} = require("@discordjs/builders");
const {serverSettingsMap} = require("../EmailBot");

module.exports = {
    data: new SlashCommandBuilder().setName('delete_user_data').setDescription('delete the stored data for the user').addStringOption(option => option.setName('verify').setDescription('type "delete" to remove the data').setRequired(true)),
    async execute(interaction) {
        if (interaction.options.getString("verify") === "delete") {
            database.deleteUserData(interaction.user.id)
            let serverSettings = serverSettingsMap.get(interaction.guildId);
            if (serverSettings === undefined) {
                interaction.reply("Data deleted!")
                return
            }
            const roleVerified = interaction.guild.roles.cache.find(role => role.id === serverSettings.verifiedRoleName);
            const roleUnverified = interaction.guild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);
            const member = interaction.guild.members.cache.get(interaction.user.id)
            if (member !== undefined) {
                if (roleVerified !== undefined) {

                    member.roles.remove(roleVerified)
                }
                if (roleUnverified !== undefined) {
                    member.roles.add(roleUnverified)
                }
            }
            await interaction.reply({content: "Data deleted and unverified!", ephemeral: true})
            return

        }
        await interaction.reply({content: "Failed to verify!", ephemeral: true})
    }
}