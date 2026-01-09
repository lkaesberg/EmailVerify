const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags } = require('discord.js');
const database = require("../database/Database.js");
const { languages } = require("../Language");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure bot settings for your server')
        .addSubcommand(subcommand =>
            subcommand
                .setName('language')
                .setDescription('Change the language for bot messages and verification prompts')
                .addStringOption(option =>
                    option
                        .setName('language')
                        .setDescription('Select a language')
                        .setRequired(true)
                        .addChoices(...[...languages.keys()].map(value => ({
                            name: value.charAt(0).toUpperCase() + value.slice(1),
                            value: value
                        })))
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('log-channel')
                .setDescription('Set a channel to log verification events')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel for verification logs (leave empty to disable)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('verify-message')
                .setDescription('Customize the message shown in verification emails')
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Custom message for verification emails (leave empty to use default)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('auto-verify')
                .setDescription('Automatically prompt new members to verify when they join')
                .addBooleanOption(option =>
                    option
                        .setName('enable')
                        .setDescription('Enable or disable auto-verify prompts for new members')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('auto-unverified')
                .setDescription('Automatically assign the unverified role to new members')
                .addBooleanOption(option =>
                    option
                        .setName('enable')
                        .setDescription('Enable or disable auto-assignment of unverified role')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (subcommand === 'language') {
                const language = interaction.options.getString('language', true);
                serverSettings.language = language;
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                await interaction.reply({
                    content: `🌐 **Language changed to:** ${language.charAt(0).toUpperCase() + language.slice(1)}\n\nAll bot messages will now be displayed in this language.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (subcommand === 'log-channel') {
                const logChannel = interaction.options.getChannel('channel');
                
                if (!logChannel) {
                    serverSettings.logChannel = "";
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: "📝 **Verification logging disabled.**\n\nVerification events will no longer be logged to a channel.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    serverSettings.logChannel = logChannel.id;
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: `📝 **Log channel set to:** <#${logChannel.id}>\n\nVerification events will be logged to this channel, including:\n• User email verifications\n• Manual verifications by admins`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'verify-message') {
                const verifyMessage = interaction.options.getString('message');
                
                if (!verifyMessage) {
                    serverSettings.verifyMessage = "";
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: "✉️ **Custom verify message removed.**\n\nVerification emails will now use the default message.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    serverSettings.verifyMessage = verifyMessage;
                    database.updateServerSettings(interaction.guildId, serverSettings);
                    await interaction.reply({
                        content: `✉️ **Custom verify message set:**\n"${verifyMessage}"\n\nThis message will be included in verification emails sent to users.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'auto-verify') {
                const enable = interaction.options.getBoolean('enable', true);
                serverSettings.autoVerify = +enable;
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                if (enable) {
                    await interaction.reply({
                        content: "✅ **Auto-verify enabled!**\n\nNew members will automatically receive a verification prompt when they join the server.",
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    await interaction.reply({
                        content: "❌ **Auto-verify disabled.**\n\nNew members will need to use `/verify` or click a verification button to start the verification process.",
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }

            if (subcommand === 'auto-unverified') {
                const enable = interaction.options.getBoolean('enable', true);
                serverSettings.autoAddUnverified = +enable;
                database.updateServerSettings(interaction.guildId, serverSettings);
                
                if (enable) {
                    const roleUnverified = interaction.guild.roles.cache.find(r => r.id === serverSettings.unverifiedRoleName);
                    if (roleUnverified) {
                        await interaction.reply({
                            content: `✅ **Auto-assign unverified role enabled!**\n\nNew members will automatically receive the **${roleUnverified.name}** role when they join.`,
                            flags: MessageFlags.Ephemeral
                        });
                    } else {
                        await interaction.reply({
                            content: "✅ **Auto-assign unverified role enabled!**\n\n⚠️ **Warning:** No unverified role is configured. Use `/role unverified` to set one first.",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                } else {
                    await interaction.reply({
                        content: "❌ **Auto-assign unverified role disabled.**\n\nNew members will not automatically receive the unverified role.",
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
        });
    }
};
