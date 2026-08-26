// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

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

    // An unknown/missing language must not throw — fall back to the default language.
    const table = languages.get(language) || languages.get(defaultLanguage);
    let locale = table ? table[string] : undefined;

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