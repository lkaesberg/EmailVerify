const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database");
const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require('discord.js');
const { MessageFlags } = require('discord.js');
const {getLocale} = require("../Language");

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('button')
        .setDescription("Create a verification button embed in a channel for users to verify")
        .addChannelOption(option => option
            .setName("channel")
            .setRequired(true)
            .setDescription("Channel where the verification embed will be posted"))
        .addStringOption(option => option
            .setName("buttontext")
            .setRequired(true)
            .setDescription("Text shown on the verify button (e.g. 'Click to Verify')"))
        .addStringOption(option => option
            .setName("title")
            .setRequired(false)
            .setDescription("Custom title for the embed (default: localized verify title)"))
        .addStringOption(option => option
            .setName("message")
            .setRequired(false)
            .setDescription("Custom description/instructions (default: localized instructions)"))
        .addStringOption(option => option
            .setName("color")
            .setRequired(false)
            .setDescription("Embed accent color in hex format (e.g. #5865F2, #FF0000)"))
        .setDefaultMemberPermissions(0),
    async execute(interaction) {
        const buttonText = interaction.options.getString("buttontext", true)
        const channel = interaction.options.getChannel("channel", true)
        const customMessage = interaction.options.getString("message")
        const customTitle = interaction.options.getString("title")
        const customColor = interaction.options.getString("color")

        await interaction.deferReply({flags: MessageFlags.Ephemeral})

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            const language = serverSettings.language

            // Use custom values or fall back to localized defaults
            const title = customTitle || getLocale(language, "verifyEmbedTitle")
            const description = customMessage || getLocale(language, "verifyEmbedInstructions")
            const footerText = getLocale(language, "verifyEmbedFooter")

            // Parse color or use default Discord blurple
            let embedColor = 0x5865F2
            if (customColor) {
                const parsed = customColor.replace('#', '')
                if (/^[0-9A-Fa-f]{6}$/.test(parsed)) {
                    embedColor = parseInt(parsed, 16)
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(embedColor)
                .setFooter({ 
                    text: `${interaction.guild.name} • ${footerText}`,
                    iconURL: interaction.guild.iconURL({ dynamic: true })
                })

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("verifyButton")
                        .setLabel(buttonText)
                        .setEmoji("📧")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId("openCodeModal")
                        .setLabel(getLocale(language, "enterCodeButton"))
                        .setEmoji("🔑")
                        .setStyle(ButtonStyle.Secondary),
                );

            const message = await channel.send({embeds: [embed], components: [buttons]}).catch(async _ => {
                await interaction.user.send("No permissions to write in that channel!").catch(async _ => {
                })
            })
            if (message === undefined) {
                return
            }

            await interaction.editReply({content: getLocale(language, "buttonCreated"), flags: MessageFlags.Ephemeral})
        })
    }
}