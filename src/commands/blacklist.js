const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
    .setDefaultPermission(true)
    .setName('blacklist')
    .setDescription('returns registered blacklist')
    .addStringOption(option => option
        .setName('email')
        .setDescription('register blacklisted emails (add multiple separated by \',\'), (pass "-" to clear)')
        ),
    async execute(interaction) {
        const blacklist = interaction.options.getString('blacklist');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!blacklist) {
                await interaction.reply("Blacklisted names: " + serverSettings.blacklist.toString());
            } else if(blacklist === "-")
                serverSettings.blacklist=[];
            else{
                    const blacklistedNames = blacklist.split(",").map(name=> name.trim());
                    await interaction.reply("Added " + blacklistedNames.toString());
                    serverSettings.blacklist = blacklistedNames;
                    database.updateServerSettings(interaction.guildId, serverSettings);
            }
        })

    }
}
