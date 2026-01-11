const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Configure verification roles for your server')
        .addSubcommand(subcommand =>
            subcommand
                .setName('verified')
                .setDescription('Set the role given to users after successful email verification')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('The role to assign to verified members (leave empty to view current)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unverified')
                .setDescription('Set an optional role for unverified members (can be auto-assigned on join)')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('The role for unverified members (select current role to disable)')
                        .setRequired(false)
                )
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'verified') {
            const verifiedRole = interaction.options.getRole('role');
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (verifiedRole == null) {
                    const role = interaction.guild.roles.cache.find(r => r.id === serverSettings.verifiedRoleName);
                    if (role === undefined) {
                        await interaction.reply({
                            content: "⚠️ **Verified role is not configured!**\nUse `/role verified` with a role to set one.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    await interaction.reply({
                        content: `✅ **Verified role:** ${role.name}\n\nUsers receive this role after successful email verification.`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    if (verifiedRole.name === "@everyone") {
                        await interaction.reply({
                            content: "❌ **Error:** @everyone cannot be used as the verified role!",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    serverSettings.verifiedRoleName = verifiedRole.id;
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: `✅ **Verified role set to:** ${verifiedRole.name}\n\nUsers will now receive this role after email verification.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
            });
        }

        if (subcommand === 'unverified') {
            const unverifiedRole = interaction.options.getRole('role');
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (unverifiedRole == null) {
                    const role = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName);
                    if (role === undefined) {
                        await interaction.reply({
                            content: "➖ **Unverified role is disabled.**\n\nYou can set one with `/role unverified` to restrict access for new members until they verify.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    await interaction.reply({
                        content: `📋 **Unverified role:** ${role.name}\n\nThis role is removed when users complete verification.\n*Tip: Select this same role again to disable the unverified role feature.*`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    if (unverifiedRole.name === "@everyone") {
                        await interaction.reply({
                            content: "❌ **Error:** @everyone cannot be used as the unverified role!",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    
                    // Toggle off if selecting the current role
                    if (unverifiedRole.id === serverSettings.unverifiedRoleName) {
                        serverSettings.unverifiedRoleName = "";
                        database.updateServerSettings(interaction.guildId, serverSettings);
                        await interaction.reply({
                            content: "➖ **Unverified role disabled.**\n\nNew members will no longer receive a special role before verification.",
                            flags: MessageFlags.Ephemeral
                        });
                    } else {
                        serverSettings.unverifiedRoleName = unverifiedRole.id;
                        database.updateServerSettings(interaction.guildId, serverSettings);
                        await interaction.reply({
                            content: `✅ **Unverified role set to:** ${unverifiedRole.name}\n\nThis role will be removed when users complete email verification.\n*Tip: Use \`/settings auto-unverified\` to auto-assign this role to new members.*`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            });
        }
    }
};
