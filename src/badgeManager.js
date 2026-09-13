const { getPreparedEmoji } = require('./emojiManager');

function getNewBadgeEmoji(guild) {
  return getPreparedEmoji(guild.client, 'pk_new');
}

module.exports = { getNewBadgeEmoji };
