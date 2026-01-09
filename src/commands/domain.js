const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");
const registerRemoveDomain = require("../bot/registerRemoveDomain");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('domain')
        .setDescription('Manage allowed email domains for verification')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add allowed email domains (supports * wildcard, e.g. @*.edu)')
                .addStringOption(option =>
                    option
                        .setName('domains')
                        .setDescription('Domain(s) to allow, e.g. @gmail.com, @*.edu (comma-separated)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove one or more allowed email domains')
                .addStringOption(option =>
                    option
                        .setName('domains')
                        .setDescription('Domain(s) to remove (comma-separated for multiple)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all currently allowed email domains')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all allowed domains (users won\'t be able to verify)')
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (subcommand === 'list') {
                if (serverSettings.domains.length === 0) {
                    await interaction.reply({
                        content: "📧 **No allowed domains configured.**\n\nAdd domains with `/domain add` to allow users with those email addresses to verify.\n\n**Examples:**\n• `@gmail.com` — Only Gmail addresses\n• `@company.com` — Specific company domain\n• `@*.edu` — Any .edu domain (wildcard)\n• `@*.harvard.edu` — Any Harvard subdomain\n\n**Wildcard (*) Explained:**\nThe `*` matches any text. So `@*.edu` allows `@stanford.edu`, `@mit.edu`, `@student.university.edu`, etc.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    const domainList = serverSettings.domains
                        .map(d => `\`${d.replaceAll("*", "✱")}\``)
                        .join('\n• ');
                    await interaction.reply({
                        content: `📧 **Allowed email domains:**\n• ${domainList}\n\n*Use \`/domain add\`, \`/domain remove\`, or \`/domain clear\` to modify.*\n\n💡 **Tip:** Use \`*\` as wildcard (e.g. \`@*.edu\` matches any .edu address)`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'add') {
                const domainsInput = interaction.options.getString('domains', true);
                const addedDomains = [];
                
                domainsInput.split(",").forEach(domain => {
                    domain = domain.trim();
                    if (domain.startsWith("@") && domain.includes(".")) {
                        if (!serverSettings.domains.includes(domain)) {
                            serverSettings.domains.push(domain);
                            addedDomains.push(domain);
                        }
                    } else if (!domain.includes("@") && domain.includes(".")) {
                        const formattedDomain = "@" + domain;
                        if (!serverSettings.domains.includes(formattedDomain)) {
                            serverSettings.domains.push(formattedDomain);
                            addedDomains.push(formattedDomain);
                        }
                    }
                });

                if (addedDomains.length !== 0) {
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await registerRemoveDomain(interaction.guildId);
                    
                    const addedList = addedDomains.map(d => `\`${d.replaceAll("*", "✱")}\``).join(', ');
                    await interaction.reply({
                        content: `✅ **Added domain(s):** ${addedList}\n\nUsers with email addresses matching these domains can now verify.\n\n💡 **Wildcard tip:** Use \`*\` to match any text (e.g. \`@*.edu\` allows all .edu emails)`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    await interaction.reply({
                        content: "❌ **No valid domains provided.**\n\n**Valid formats:**\n• `@gmail.com` or `gmail.com` — Specific domain\n• `@*.edu` — Wildcard (matches any .edu)\n• `@*.company.com` — Subdomain wildcard\n• `@domain1.com, @domain2.org` — Multiple domains\n\n**Wildcard (*) Explained:**\nThe `*` matches any text before the specified part.\n`@*.edu` → `@stanford.edu` ✓, `@mit.edu` ✓, `@cs.berkeley.edu` ✓",
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'remove') {
                const domainsInput = interaction.options.getString('domains', true);
                const removeDomains = domainsInput.split(",").map(d => d.trim());
                
                // Also check for versions without @ prefix
                const expandedRemove = [];
                removeDomains.forEach(d => {
                    expandedRemove.push(d);
                    if (!d.startsWith("@")) {
                        expandedRemove.push("@" + d);
                    }
                });
                
                const deletedDomains = serverSettings.domains.filter(domain => 
                    expandedRemove.includes(domain)
                );
                serverSettings.domains = serverSettings.domains.filter(domain => 
                    !expandedRemove.includes(domain)
                );

                if (deletedDomains.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **No matching domains found to remove.**\n\nUse `/domain list` to see current domains.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await registerRemoveDomain(interaction.guildId, { data: this.data });
                    
                    const removedList = deletedDomains.map(d => `\`${d.replaceAll("*", "✱")}\``).join(', ');
                    await interaction.reply({
                        content: `🗑️ **Removed domain(s):** ${removedList}\n\nUsers with these email addresses can no longer verify.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'clear') {
                if (serverSettings.domains.length === 0) {
                    await interaction.reply({
                        content: "⚠️ **Domain list is already empty.**",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const count = serverSettings.domains.length;
                serverSettings.domains = [];
                database.updateServerSettings(interaction.guildId, serverSettings);
                await registerRemoveDomain(interaction.guildId, { data: this.data });

                await interaction.reply({
                    content: `🗑️ **All domains cleared!**\n\nRemoved ${count} ${count === 1 ? 'domain' : 'domains'}.\n\n⚠️ **Warning:** Users cannot verify until you add allowed domains with \`/domain add\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        });
    }
};
