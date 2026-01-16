const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Configure verification roles for your server')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a default role given to all verified users')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('The role to add to the default roles list')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a role from the default roles list')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('The role to remove from the default roles list')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all default roles assigned to verified users')
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

        if (subcommand === 'add') {
            const role = interaction.options.getRole('role', true);
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (role.name === "@everyone") {
                    await interaction.reply({
                        content: "**Error:** @everyone cannot be used as a verified role!",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                // Check if role is already in the list
                if (serverSettings.defaultRoles.includes(role.id)) {
                    await interaction.reply({
                        content: `**${role.name}** is already a default role.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                serverSettings.defaultRoles.push(role.id);
                // Also update legacy field for backward compatibility
                if (serverSettings.defaultRoles.length === 1) {
                    serverSettings.verifiedRoleName = role.id;
                }
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                await interaction.reply({
                    content: `**Default role added:** ${role.name}\n\nAll verified users will now receive this role.\n*Use \`/role list\` to see all default roles.*`,
                    flags: MessageFlags.Ephemeral
                });
            });
        }

        if (subcommand === 'remove') {
            const role = interaction.options.getRole('role', true);
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                const index = serverSettings.defaultRoles.indexOf(role.id);
                if (index === -1) {
                    await interaction.reply({
                        content: `**${role.name}** is not in the default roles list.\n\nUse \`/role list\` to see current default roles.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                serverSettings.defaultRoles.splice(index, 1);
                // Update legacy field
                if (serverSettings.defaultRoles.length > 0) {
                    serverSettings.verifiedRoleName = serverSettings.defaultRoles[0];
                } else {
                    serverSettings.verifiedRoleName = "";
                }
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                await interaction.reply({
                    content: `**Default role removed:** ${role.name}\n\nVerified users will no longer receive this role automatically.`,
                    flags: MessageFlags.Ephemeral
                });
            });
        }

        if (subcommand === 'list') {
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (serverSettings.defaultRoles.length === 0) {
                    await interaction.reply({
                        content: "**No default roles configured!**\n\nUse `/role add` to add roles that all verified users will receive.\n\n*Tip: You can also use `/domainrole` to assign different roles based on email domain.*",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                const roleNames = serverSettings.defaultRoles
                    .map(id => {
                        const role = interaction.guild.roles.cache.get(id);
                        return role ? `<@&${id}>` : `Unknown (${id})`;
                    })
                    .join('\n');
                
                await interaction.reply({
                    content: `**Default Roles** (assigned to all verified users):\n${roleNames}\n\n*Use \`/role add\` or \`/role remove\` to modify.\nUse \`/domainrole\` to assign additional roles based on email domain.*`,
                    flags: MessageFlags.Ephemeral
                });
            });
        }

        if (subcommand === 'unverified') {
            const unverifiedRole = interaction.options.getRole('role');
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (unverifiedRole == null) {
                    const role = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName);
                    if (role === undefined) {
                        await interaction.reply({
                            content: "**Unverified role is disabled.**\n\nYou can set one with `/role unverified` to restrict access for new members until they verify.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    await interaction.reply({
                        content: `**Unverified role:** ${role.name}\n\nThis role is removed when users complete verification.\n*Tip: Select this same role again to disable the unverified role feature.*`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    if (unverifiedRole.name === "@everyone") {
                        await interaction.reply({
                            content: "**Error:** @everyone cannot be used as the unverified role!",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    
                    // Toggle off if selecting the current role
                    if (unverifiedRole.id === serverSettings.unverifiedRoleName) {
                        serverSettings.unverifiedRoleName = "";
                        database.updateServerSettings(interaction.guildId, serverSettings);
                        await interaction.reply({
                            content: "**Unverified role disabled.**\n\nNew members will no longer receive a special role before verification.",
                            flags: MessageFlags.Ephemeral
                        });
                    } else {
                        serverSettings.unverifiedRoleName = unverifiedRole.id;
                        database.updateServerSettings(interaction.guildId, serverSettings);
                        await interaction.reply({
                            content: `**Unverified role set to:** ${unverifiedRole.name}\n\nThis role will be removed when users complete email verification.\n*Tip: Use \`/settings auto-unverified\` to auto-assign this role to new members.*`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            });
        }
    }
};
