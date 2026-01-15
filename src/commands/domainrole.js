const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('domainrole')
        .setDescription('Configure domain-specific roles for verification')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a role for a specific email domain')
                .addStringOption(option =>
                    option
                        .setName('domain')
                        .setDescription('Email domain (e.g., @company.com, @*.edu)')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('The role to assign for this domain')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a role from a specific email domain')
                .addStringOption(option =>
                    option
                        .setName('domain')
                        .setDescription('Email domain (e.g., @company.com, @*.edu)')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('The role to remove from this domain')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all domain-role mappings')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all roles for a specific domain')
                .addStringOption(option =>
                    option
                        .setName('domain')
                        .setDescription('Email domain to clear roles for')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .setDefaultMemberPermissions(0),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const domains = serverSettings.domains || [];
            
            // Filter domains based on user input
            const filtered = domains
                .filter(domain => domain.toLowerCase().includes(focusedValue))
                .slice(0, 25); // Discord allows max 25 choices
            
            await interaction.respond(
                filtered.map(domain => ({
                    name: domain.replaceAll('*', '✱'),
                    value: domain
                }))
            ).catch(() => {});
        });
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Helper to normalize domain format
        const normalizeDomain = (domain) => {
            domain = domain.trim().toLowerCase();
            if (!domain.startsWith('@')) {
                domain = '@' + domain;
            }
            return domain;
        };

        if (subcommand === 'add') {
            let domain = interaction.options.getString('domain', true);
            const role = interaction.options.getRole('role', true);
            
            domain = normalizeDomain(domain);
            
            // Validate domain format
            if (!domain.includes('.')) {
                await interaction.reply({
                    content: "**Invalid domain format!**\n\nDomain must include a dot (e.g., `@company.com`, `@*.edu`).",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            
            if (role.name === "@everyone") {
                await interaction.reply({
                    content: "**Error:** @everyone cannot be used as a domain role!",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                // Initialize domainRoles if needed
                if (!serverSettings.domainRoles) {
                    serverSettings.domainRoles = {};
                }
                
                // Initialize array for this domain if needed
                if (!serverSettings.domainRoles[domain]) {
                    serverSettings.domainRoles[domain] = [];
                }
                
                // Check if role already exists for this domain
                if (serverSettings.domainRoles[domain].includes(role.id)) {
                    await interaction.reply({
                        content: `**${role.name}** is already assigned to \`${domain}\`.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                serverSettings.domainRoles[domain].push(role.id);
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                const totalRoles = serverSettings.domainRoles[domain].length;
                await interaction.reply({
                    content: `**Domain role added!**\n\nDomain: \`${domain}\`\nRole: ${role.name}\n\nUsers verifying with this domain will receive ${totalRoles} role${totalRoles > 1 ? 's' : ''} (plus any default roles).`,
                    flags: MessageFlags.Ephemeral
                });
            });
        }

        if (subcommand === 'remove') {
            let domain = interaction.options.getString('domain', true);
            const role = interaction.options.getRole('role', true);
            
            domain = normalizeDomain(domain);
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (!serverSettings.domainRoles || !serverSettings.domainRoles[domain]) {
                    await interaction.reply({
                        content: `**No roles configured for \`${domain}\`.**\n\nUse \`/domainrole list\` to see all domain-role mappings.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                const index = serverSettings.domainRoles[domain].indexOf(role.id);
                if (index === -1) {
                    await interaction.reply({
                        content: `**${role.name}** is not assigned to \`${domain}\`.\n\nUse \`/domainrole list\` to see all domain-role mappings.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                serverSettings.domainRoles[domain].splice(index, 1);
                
                // Clean up empty domain entries
                if (serverSettings.domainRoles[domain].length === 0) {
                    delete serverSettings.domainRoles[domain];
                }
                
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                await interaction.reply({
                    content: `**Domain role removed!**\n\nDomain: \`${domain}\`\nRole: ${role.name}\n\nUsers verifying with this domain will no longer receive this role.`,
                    flags: MessageFlags.Ephemeral
                });
            });
        }

        if (subcommand === 'list') {
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                const domainRoles = serverSettings.domainRoles || {};
                const domains = Object.keys(domainRoles);
                
                if (domains.length === 0) {
                    // Show default roles info
                    let message = "**No domain-specific roles configured.**\n\n";
                    if (serverSettings.defaultRoles.length > 0) {
                        const defaultRoleNames = serverSettings.defaultRoles
                            .map(id => {
                                const role = interaction.guild.roles.cache.get(id);
                                return role ? `<@&${id}>` : `Unknown (${id})`;
                            })
                            .join(', ');
                        message += `**Default roles** (all verified users): ${defaultRoleNames}\n\n`;
                    }
                    message += "Use `/domainrole add` to assign specific roles based on email domain.\n\n";
                    message += "**Example:**\n`/domainrole add domain:@company.com role:Employee`\n`/domainrole add domain:@*.edu role:Student`";
                    
                    await interaction.reply({
                        content: message,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                let message = "**Domain-Specific Roles:**\n\n";
                
                for (const domain of domains) {
                    const roleIds = domainRoles[domain];
                    const roleNames = roleIds
                        .map(id => {
                            const role = interaction.guild.roles.cache.get(id);
                            return role ? `<@&${id}>` : `Unknown (${id})`;
                        })
                        .join(', ');
                    
                    message += `\`${domain}\` → ${roleNames}\n`;
                }
                
                // Add default roles info
                if (serverSettings.defaultRoles.length > 0) {
                    const defaultRoleNames = serverSettings.defaultRoles
                        .map(id => {
                            const role = interaction.guild.roles.cache.get(id);
                            return role ? `<@&${id}>` : `Unknown (${id})`;
                        })
                        .join(', ');
                    message += `\n**Default roles** (all domains): ${defaultRoleNames}`;
                }
                
                message += "\n\n*Users receive domain-specific roles + default roles upon verification.*";
                
                await interaction.reply({
                    content: message,
                    flags: MessageFlags.Ephemeral
                });
            });
        }

        if (subcommand === 'clear') {
            let domain = interaction.options.getString('domain', true);
            domain = normalizeDomain(domain);
            
            await database.getServerSettings(interaction.guildId, async serverSettings => {
                if (!serverSettings.domainRoles || !serverSettings.domainRoles[domain]) {
                    await interaction.reply({
                        content: `**No roles configured for \`${domain}\`.**`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                const count = serverSettings.domainRoles[domain].length;
                delete serverSettings.domainRoles[domain];
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                await interaction.reply({
                    content: `**Cleared all roles for \`${domain}\`!**\n\nRemoved ${count} role${count > 1 ? 's' : ''}.\n\nUsers verifying with this domain will now only receive default roles.`,
                    flags: MessageFlags.Ephemeral
                });
            });
        }
    }
};
