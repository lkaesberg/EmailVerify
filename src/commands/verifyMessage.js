const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database");
module.exports = {
    data: new SlashCommandBuilder().setName('verifymessage').setDescription('Change verify message. (No arguments resets to default)').addStringOption(option => option.setName("verifymessage").setDescription("Set custom verify message")),
    async execute(interaction) {
        const verifyMessage = interaction.options.getString("verifymessage")
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!verifyMessage) {
                serverSettings.verifyMessage = ""
            } else {
                serverSettings.verifyMessage = verifyMessage
            }
            await interaction.reply("Modified verify message")
            database.updateServerSettings(interaction.guildId, serverSettings)
        })

    }
}