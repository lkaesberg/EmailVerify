const { SlashCommandBuilder } = require("@discordjs/builders");
const database = require("../database/Database.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('allowlist')
        .setDescription('returns registered allowlist')
        .addStringOption(option => option
            .setName('email')
            .setDescription('register allowlisted emails (add multiple separated by ","), (pass "-" to clear)')
        ),
    async execute(interaction) {
        const allowlist = interaction.options.getString('email');
        await database.getServerSettings(interaction.guildId, async serverSettings => {
            if (!allowlist) {
                await interaction.reply("Allowlisted emails:\n" + serverSettings.allowlist.join(", "));
            } else if (allowlist === "-") {
                serverSettings.allowlist = [];
                database.updateServerSettings(interaction.guildId, serverSettings);
                await interaction.reply("Allowlist cleared!");
            } else {
                const newAllowlists = allowlist.split(",").map(name => name.trim())
                const allowlistedNames = (format = false) => serverSettings.allowlist.concat(format ? newAllowlists.map(v => `**${v}**`) : newAllowlists);
                await interaction.reply("Added:\n" + allowlistedNames(true).join(", "));
                serverSettings.allowlist = allowlistedNames();
                database.updateServerSettings(interaction.guildId, serverSettings);
            }
        })

    }
}
