const {SlashCommandBuilder} = require("@discordjs/builders");
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
    .setDefaultPermission(true)
    .setName('blacklist')
    .setDescription('returns registered blacklist')
    .addStringOption(option => option
        .setName('email')
        .setDescription('register blacklisted emails (add multiple separated by ","), (pass "-" to clear)')
        ).setDefaultMemberPermissions(0),
    async execute(interaction) {
        const blacklist = interaction.options.getString('email');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!blacklist) {
                await interaction.reply("Blacklisted emails:\n" + serverSettings.blacklist.join(", "));
            } else if (blacklist === "-") {
                serverSettings.blacklist=[];
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply("Blacklist cleared!");
            }
            else {
                const newBlacklists = blacklist.split(",").map(name=> name.trim())
                const blacklistedNames = (format = false) => serverSettings.blacklist
                    .concat(format ? newBlacklists.map(v=> `**${v}**`) : newBlacklists);
                await interaction.reply("Added:\n" + blacklistedNames(true).join(", "));
                serverSettings.blacklist = blacklistedNames();
                database.updateServerSettings(interaction.guildId, serverSettings);
            }
        })

    }
}
