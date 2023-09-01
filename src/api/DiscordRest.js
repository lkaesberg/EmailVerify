const {REST} = require("@discordjs/rest");
const {token} = require("../../config/config.json");

module.exports = new REST({ version: '10' }).setToken(token);