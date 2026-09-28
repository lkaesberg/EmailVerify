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

// Discord's locale codes (guild.preferredLocale) mapped to our language files. Discord
// has no Hebrew locale, so Hebrew servers keep choosing it with /settings language.
const DISCORD_LOCALES = {
    'de': 'german',
    'fr': 'french',
    'es-ES': 'spanish',
    'es-419': 'spanish',
    'pt-BR': 'brazilianPortuguese',
    'pl': 'polish',
    'tr': 'turkish',
    'ko': 'korean',
    'th': 'thai'
}

/** Our language for a Discord locale code, or the default when we don't speak it. */
function languageForLocale(locale) {
    const language = DISCORD_LOCALES[locale]
    return language && languages.has(language) ? language : defaultLanguage
}

// The reverse: each of our languages → the Discord locales it serves.
const LANGUAGE_LOCALES = {}
for (const [locale, language] of Object.entries(DISCORD_LOCALES)) {
    (LANGUAGE_LOCALES[language] = LANGUAGE_LOCALES[language] || []).push(locale)
}

/**
 * `{discordLocale: text}` for a string key, for a slash command's
 * setDescriptionLocalizations, so Discord's own command picker shows the admin's
 * language. Languages still carrying the English text are left out (Discord falls
 * back to the default description), and Discord's 100-character limit is enforced.
 */
function discordLocalizations(key) {
    const english = languages.get(defaultLanguage)?.[key]
    const out = {}
    for (const [language, locales] of Object.entries(LANGUAGE_LOCALES)) {
        const text = languages.get(language)?.[key]
        if (typeof text !== 'string' || !text || text === english) continue
        for (const locale of locales) out[locale] = text.slice(0, 100)
    }
    return out
}

module.exports = {getLocale, languages, defaultLanguage, languageForLocale, discordLocalizations}