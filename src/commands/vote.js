// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { SlashCommandBuilder } = require("@discordjs/builders");
const voting = require("../utils/voting");

// Open to every member: anyone can vote, and each vote gives this server bonus emails.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Vote for EmailVerify and give this server free bonus verification emails')
        .setDefaultMemberPermissions(null),

    async execute(interaction) {
        await voting.showVotePrompt(interaction, interaction.guildId, 'command')
    }
};
