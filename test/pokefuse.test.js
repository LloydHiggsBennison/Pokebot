const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { loadModule, fakeMessage, fakeClient, fakeDatabase } = require('./helpers');

function fixture() {
  const db = fakeDatabase();
  for (let i = 0; i < 5; i++) db.captures.push({ guildId: 'guild', userId: 'owner', id: 25, name: 'pikachu', isShiny: false });
  for (let i = 0; i < 4; i++) db.captures.push({ guildId: 'guild', userId: 'other', id: 25, name: 'pikachu', isShiny: false });
  const manager = loadModule('src/pokefuseManager.js', {
    './database': db,
    './emojiManager': { getPreparedEmoji() { return '<:pkv2_25:123>'; } },
  });
  const client = fakeClient().client;
  const message = fakeMessage(client, 'owner');
  message.guild.id = 'guild';
  message.author.username = 'owner';
  const interactions = [];
  const reply = async payload => { const sent = { id: 'fuse-message', payload, async edit(next) { this.payload = next; } }; interactions.push(sent); return sent; };
  message.reply = reply;
  return { db, manager, message, interactions };
}

test('$pokefuse only offers normal species with five copies', async () => {
  const f = fixture();
  await f.manager.showFuse(f.message);
  assert.equal(f.interactions.length, 1);
  const payload = f.interactions[0].payload;
  assert.match(payload.embeds[0].data.title, /Fusión/);
  assert.match(payload.embeds[0].data.fields[0].value, /Pikachu.*x5/);
  assert.equal(payload.components[0].components[0].toJSON().options[0].value, '25');
});

test('fusion consumes exactly four normals and creates one shiny', async () => {
  const f = fixture();
  await f.manager.showFuse(f.message);
  const token = f.interactions[0].payload.components[0].components[0].data.custom_id.split(':')[1];
  const interaction = { customId: `pokefuse:${token}`, values: ['25'], user: { id: 'owner' }, guildId: 'guild', message: { id: 'fuse-message' },
    async update(payload) { this.updated = payload; }, async reply(payload) { this.replied = payload; } };
  await f.manager.handleFuseSelect(interaction);
  assert.equal(f.db.captures.filter(p => p.guildId === 'guild' && p.userId === 'owner' && p.id === 25 && !p.isShiny).length, 1);
  assert.equal(f.db.captures.filter(p => p.guildId === 'guild' && p.userId === 'owner' && p.id === 25 && p.isShiny).length, 1);
  assert.match(interaction.updated.content, /consumieron 4/);
  assert.equal(interaction.updated.components.length, 0);
});

test('fusion selector is owner-only and duplicate clicks cannot consume twice', async () => {
  const f = fixture();
  await f.manager.showFuse(f.message);
  const token = f.interactions[0].payload.components[0].components[0].data.custom_id.split(':')[1];
  const base = { customId: `pokefuse:${token}`, values: ['25'], guildId: 'guild', message: { id: 'fuse-message' }, async update(p) { this.updated = p; }, async reply(p) { this.replied = p; } };
  const other = { ...base, user: { id: 'other' } };
  await f.manager.handleFuseSelect(other);
  assert.equal(other.replied.flags, MessageFlags.Ephemeral);
  assert.equal(f.db.captures.filter(p => p.userId === 'owner').length, 5);
  const first = { ...base, user: { id: 'owner' } };
  await f.manager.handleFuseSelect(first);
  const second = { ...base, user: { id: 'owner' } };
  await f.manager.handleFuseSelect(second);
  assert.match(second.replied?.content || second.updated?.content || '', /expiró|cinco|consumir/);
  assert.equal(f.db.captures.filter(p => p.userId === 'owner' && p.isShiny).length, 1);
});

test('cannot fuse shiny copies as ingredients', async () => {
  const f = fixture();
  f.db.captures.splice(0, f.db.captures.length, ...f.db.captures.filter(p => p.userId !== 'owner'));
  for (let i = 0; i < 10; i++) f.db.captures.push({ guildId: 'guild', userId: 'owner', id: 25, name: 'pikachu', isShiny: true });
  const replies = [];
  f.message.reply = async payload => { replies.push(payload); return { id: 'fuse-message' }; };
  await f.manager.showFuse(f.message);
  assert.match(replies[0], /Aún no tienes/);
  assert.doesNotMatch(replies[0], /Pikachu/);
});
