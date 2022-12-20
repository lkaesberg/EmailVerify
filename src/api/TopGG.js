const {topggToken} = require("../../config.json");
const {AutoPoster} = require("topgg-autoposter");

module.exports = function (bot) {
    if (topggToken !== undefined) {
        const poster = AutoPoster(topggToken, bot);
        poster.on("error", _ => {
        })
        console.log("Posting stats to topGG!")
    } else {
        console.log("No topGG token!")
    }
}
