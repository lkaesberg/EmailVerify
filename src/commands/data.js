const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('data')
        .setDescription('Manage stored data for privacy and compliance')
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete-user')
                .setDescription('Delete your personal verification data and remove your verified status')
                .addStringOption(option =>
                    option
                        .setName('confirm')
                        .setDescription('Type "delete" to confirm deletion of your data')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete-server')
                .setDescription('Delete all server data and remove the bot from this server')
                .addStringOption(option =>
                    option
                        .setName('confirm')
                        .setDescription('Type "delete" to confirm - THIS WILL REMOVE THE BOT')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(null), // null allows everyone to use delete-user, but delete-server is admin-only in execute

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'delete-user') {
            const confirm = interaction.options.getString('confirm', true);
            
            if (confirm !== 'delete') {
                await interaction.reply({
                    content: "❌ **Confirmation failed.**\n\nTo delete your data, type `delete` in the confirm field.\n\n⚠️ This will:\n• Remove your verified status on this server\n• Delete your stored email hash\n• Require you to verify again",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            database.deleteUserData(interaction.user.id);
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                const roleVerified = interaction.guild.roles.cache.find(role => role.id === serverSettings.verifiedRoleName);
                const roleUnverified = interaction.guild.roles.cache.find(role => role.id === serverSettings.unverifiedRoleName);
                const member = interaction.guild.members.cache.get(interaction.user.id);
                
                if (member !== undefined) {
                    if (roleVerified !== undefined) {
                        await member.roles.remove(roleVerified).catch(() => {});
                    }
                    if (roleUnverified !== undefined) {
                        await member.roles.add(roleUnverified).catch(() => {});
                    }
                }
                
                await interaction.reply({
                    content: "✅ **Your data has been deleted.**\n\n• Your verified status has been removed\n• Your stored email hash has been deleted\n• You can verify again at any time with `/verify`",
                    flags: MessageFlags.Ephemeral
                });
            });
            return;
        }

        if (subcommand === 'delete-server') {
            // Check admin permissions for server deletion
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({
                    content: "❌ **Permission denied.**\n\nOnly server administrators can delete server data.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const confirm = interaction.options.getString('confirm', true);
            
            if (confirm !== 'delete') {
                await interaction.reply({
                    content: "❌ **Confirmation failed.**\n\nTo delete server data, type `delete` in the confirm field.\n\n⚠️ **Warning:** This will:\n• Delete all server configuration\n• Delete all verification records\n• Remove the bot from this server",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            database.deleteServerData(interaction.guildId);
            await interaction.reply({
                content: "✅ **Server data deleted.**\n\nThe bot will now leave this server. Thank you for using Email Verify Bot!",
                flags: MessageFlags.Ephemeral
            });
            await interaction.guild.leave();
        }
    }
};
