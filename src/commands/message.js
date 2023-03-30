const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder().setDefaultPermission(true).setName('message').setDescription("write message to react to in channel").addChannelOption(option => option.setName("channel").setRequired(true).setDescription("channel")).addStringOption(option => option.setName("message").setRequired(true).setDescription("message")).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const messageText = interaction.options.getString("message", true)
        const channel = interaction.options.getChannel("channel", true)

        await interaction.deferReply({ephemeral: true})

        const message = await channel.send({content: messageText}).catch(async _ => {
            await interaction.user.send("No permissions to write in that channel!")
        })
        if (message === undefined) {
            return
        }
        await message.react("📝").catch(async _ => {
            await interaction.user.send("No permissions to add reactions in that channel!")
        })

        await database.getServerSettings(interaction.guildId, async serverSettings => {
            serverSettings.channelID = channel.id
            serverSettings.messageID = message.id
            database.updateServerSettings(interaction.guildId, serverSettings)
            await interaction.editReply({content: 'Message sent', ephemeral: true})
        })

    }
}