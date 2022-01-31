const {topggToken} = require("../../config.json");
const {AutoPoster} = require("topgg-autoposter");

module.exports = function (bot) {
    if (topggToken !== undefined) {
        AutoPoster(topggToken, bot);
        console.log("Posting stats to topGG!")
    } else {
        console.log("No topGG token!")
    }
}
