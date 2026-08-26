// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const {topggToken} = require("../../config/config.json");
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
