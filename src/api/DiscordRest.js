const {REST} = require("@discordjs/rest");
const {token} = require("../../config.json");

module.exports = new REST().setToken(token);