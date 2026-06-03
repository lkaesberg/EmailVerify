const { SlashCommandBuilder } = require("@discordjs/builders");
const { MessageFlags, EmbedBuilder } = require('discord.js');
const database = require("../database/Database.js");
const { languages, getLocale } = require("../Language");
const premiumManager = require("../premium/PremiumManager");

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
        .addSubcommand(subcommand =>
            subcommand
                .setName('email-style')
                .setDescription('Choose how verification emails are rendered (plain text or HTML)')
                .addStringOption(option =>
                    option
                        .setName('style')
                        .setDescription('plain = deliverability-optimized text (default), styled = HTML (may trigger spam filters)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'plain', value: 'plain' },
                            { name: 'styled', value: 'styled' }
                        )
                )
                .addBooleanOption(option =>
                    option
                        .setName('confirm')
                        .setDescription('Required when switching to styled - acknowledges the spam-filter risk')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('mail-mode')
                .setDescription('Choose mail delivery: free 25/month self-SMTP, or premium ZeptoMail paid per credit')
                .addStringOption(option =>
                    option
                        .setName('mode')
                        .setDescription('free = 25 self-SMTP sends/month, zeptomail = every send via ZeptoMail (1 credit each)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'free', value: 'free' },
                            { name: 'zeptomail', value: 'zeptomail' }
                        )
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
                return;
            }

            if (subcommand === 'mail-mode') {
                const language = serverSettings.language || 'english';
                const mode = interaction.options.getString('mode', true);

                if (!premiumManager.enabled) {
                    await interaction.reply({
                        content: getLocale(language, 'premiumNotEnabled'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (mode === 'zeptomail' && !premiumManager.zeptoConfigured) {
                    await interaction.reply({
                        content: getLocale(language, 'mailModeZeptoUnavailable'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const premium = await database.getGuildPremium(interaction.guildId);
                if (mode === 'zeptomail' && premium.bonusCredits <= 0) {
                    const embed = new EmbedBuilder()
                        .setTitle(getLocale(language, 'mailModeZeptoNoCreditsTitle'))
                        .setDescription(getLocale(language, 'mailModeZeptoNoCreditsDescription'))
                        .setColor(0xFFA500);
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    return;
                }

                await database.setGuildMailMode(interaction.guildId, mode);

                const titleKey = mode === 'zeptomail' ? 'mailModeSetZeptoTitle' : 'mailModeSetFreeTitle';
                const descKey = mode === 'zeptomail' ? 'mailModeSetZeptoDescription' : 'mailModeSetFreeDescription';
                const descVars = mode === 'zeptomail'
                    ? [premium.bonusCredits.toString()]
                    : [premiumManager.freeMonthlyLimit.toString()];
                const embed = new EmbedBuilder()
                    .setTitle(getLocale(language, titleKey))
                    .setDescription(getLocale(language, descKey, ...descVars))
                    .setColor(mode === 'zeptomail' ? 0x5865F2 : 0x57F287);
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (subcommand === 'email-style') {
                const language = serverSettings.language || 'english';
                const style = interaction.options.getString('style', true);
                const confirm = interaction.options.getBoolean('confirm') || false;

                if (style === 'styled' && !confirm) {
                    const warningEmbed = new EmbedBuilder()
                        .setTitle(getLocale(language, 'emailStyleSpamWarningTitle'))
                        .setDescription(getLocale(language, 'emailStyleSpamWarning'))
                        .setColor(0xFFA500);
                    await interaction.reply({ embeds: [warningEmbed], flags: MessageFlags.Ephemeral });
                    return;
                }

                serverSettings.emailStyle = style;
                database.updateServerSettings(interaction.guildId, serverSettings);

                const titleKey = style === 'styled' ? 'emailStyleSetStyledTitle' : 'emailStyleSetPlainTitle';
                const descKey = style === 'styled' ? 'emailStyleSetStyledDescription' : 'emailStyleSetPlainDescription';
                const confirmEmbed = new EmbedBuilder()
                    .setTitle(getLocale(language, titleKey))
                    .setDescription(getLocale(language, descKey))
                    .setColor(style === 'styled' ? 0xFFA500 : 0x57F287);
                await interaction.reply({ embeds: [confirmEmbed], flags: MessageFlags.Ephemeral });
            }
        });
    }
};
