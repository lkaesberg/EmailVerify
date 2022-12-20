const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database");
const {MessageActionRow, MessageButton} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('button').setDescription("create button to react to in channel").addChannelOption(option => option.setName("channel").setRequired(true).setDescription("channel")).addStringOption(option => option.setName("message").setRequired(true).setDescription("message")).addStringOption(option => option.setName("buttontext").setRequired(true).setDescription("Button text")),
    async execute(interaction) {
        const messageText = interaction.options.getString("message", true)
        const buttonText = interaction.options.getString("buttontext", true)
        const channel = interaction.options.getChannel("channel", true)

        await interaction.deferReply({ephemeral: true})
        const button = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId("verifyButton")
                    .setLabel(buttonText)
                    .setStyle('PRIMARY'),
            );
        const message = await channel.send({content: messageText, components: [button]}).catch(async _ => {
            await interaction.user.send("No permissions to write in that channel!").catch(async _ => {
            })
        })
        if (message === undefined) {
            return
        }

        await interaction.editReply({content: 'Button created', ephemeral: true})
    }
}