const fs = require("fs");

const languageFiles = fs.readdirSync('./language').filter(file => file.endsWith('.json'));
const languages = new Map()

const defaultLanguage = "english"

for (const file of languageFiles) {
    const language = require(`../language/${file}`)
    const name = file.split(".")[0]
    languages.set(name, language)
}

// Function to get locales and replace variables
function getLocale(language, string, ...vars) {

    let locale = languages.get(language)[string];

    if (locale === undefined) {
        locale = languages.get(defaultLanguage)[string];
    }
    if (locale === undefined) {
        return "ERROR: Can't find message!"
    }


    let count = 0;
    locale = locale.replace(/%VAR%/g, () => {
        let variable = vars[count] !== null ? vars[count] : "%VAR%"
        count += 1
        return variable
    });

    return locale;
}

module.exports = {getLocale, languages, defaultLanguage}