// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

const { ShardingManager } = require('discord.js');
const path = require('path');
const { token, topggToken } = require('../config/config.json');
const { AutoPoster } = require('topgg-autoposter');

const manager = new ShardingManager(path.join(__dirname, 'EmailBot.js'), {
  token,
  totalShards: 'auto',
  respawn: true,
});

manager.on('shardCreate', (shard) => {
  console.log(`Launched shard ${shard.id}`);
});

(async () => {
  try {
    await manager.spawn();
    if (typeof topggToken !== 'undefined') {
      const poster = AutoPoster(topggToken, manager);
      poster.on('error', () => {});
      console.log('Posting stats to topGG via manager!');
    } else {
      console.log('No topGG token!');
    }
  } catch (error) {
    console.error('Failed to spawn shards:', error);
    process.exit(1);
  }
})();


