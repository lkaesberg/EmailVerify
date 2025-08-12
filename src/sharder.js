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


