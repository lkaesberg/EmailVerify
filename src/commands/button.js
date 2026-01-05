const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database");
const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require('discord.js');
const { MessageFlags } = require('discord.js');
const {getLocale} = require("../Language");

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('button')
        .setDescription("Create a verification button in a channel")
        .addChannelOption(option => option
            .setName("channel")
            .setRequired(true)
            .setDescription("The channel to send the verification message to"))
        .addStringOption(option => option
            .setName("buttontext")
            .setRequired(true)
            .setDescription("The text displayed on the button"))
        .addStringOption(option => option
            .setName("message")
            .setRequired(false)
            .setDescription("Custom description (overrides default locale text)"))
        .addStringOption(option => option
            .setName("title")
            .setRequired(false)
            .setDescription("Custom embed title (overrides default locale title)"))
        .addStringOption(option => option
            .setName("color")
            .setRequired(false)
            .setDescription("Embed color in hex (e.g., #5865F2)"))
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

            const button = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("verifyButton")
                        .setLabel(buttonText)
                        .setEmoji("📧")
                        .setStyle(ButtonStyle.Success),
                );

            const message = await channel.send({embeds: [embed], components: [button]}).catch(async _ => {
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