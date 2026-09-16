const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { loadModule } = require('./helpers');
const { withLanguage } = require('../src/i18n');
function fixture(count = 21) {
  let now = Date.now();
  const reads = [], edits = [];
  const entries = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `pokemon${i+1}`, count: i === 0 ? 2 : 1,
    copies:[{id:i+1,pokemon_id:i+1,level:10,iv_total:186}] }));
  const manager = loadModule('src/pokedexManager.js', {
    './database': { async getPokedexEntries(g,u) { reads.push([g,u]); return entries.map(p => ({ ...p })); } },
    './emojiManager': { getPreparedEmoji(client, name) { return `<:${name}:123456789012345678>`; } },
  }, { Date: { now: () => now } });
  const message = { guild: { id: 'guild', client: {} }, author: { id: 'owner', username: 'Trainer', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    async reply() { return { id: 'message', async edit(payload) { edits.push(payload); } }; } };
  const interaction = (customId, overrides = {}) => ({ customId, user: { id: 'owner' }, guildId: 'guild', message: { id: 'message' },
    async update(p) { this.updated = p; }, async reply(p) { this.replied = p; }, ...overrides });
  return { manager, message, reads, edits, interaction, entries, expire() { now += 600001; } };
}

test('English pokedex translates pagination and owner-only errors',async()=>{
  const f=fixture();
  await withLanguage('en',()=>f.manager.showPokedex(f.message));
  assert.match(f.edits[0].embeds[0].data.footer.text,/Page 1/);
  const click=f.interaction(f.edits[0].components[0].toJSON().components[1].custom_id,{user:{id:'other'}});
  await withLanguage('en',()=>f.manager.handlePokedexButton(click));
  assert.match(click.replied.content,/belongs to someone else/);
});

test('mentioned users collection is queried while navigation belongs to the viewer',async()=>{
  const f=fixture();
  await f.manager.showPokedex(f.message,{id:'target',username:'OtherTrainer'});
  assert.deepEqual(f.reads,[['guild','target']]);
  assert.equal(f.edits[0].embeds[0].data.author.name,'OtherTrainer');
  const id=f.edits[0].components[0].components[1].data.custom_id;
  const viewer=f.interaction(id);await f.manager.handlePokedexButton(viewer);assert.ok(viewer.updated);
  const target=f.interaction(id,{user:{id:'target'}});await f.manager.handlePokedexButton(target);assert.ok(target.replied);
});

test('pokedex shows ten rows, counts, owner, thumbnail, totals and pages', async () => {
  const f = fixture();
  await f.manager.showPokedex(f.message);
  assert.deepEqual(f.reads, [['guild', 'owner']]);
  const payload = f.edits[0], embed = payload.embeds[0].toJSON();
  assert.equal(embed.description.split('\n').length, 10);
  assert.match(embed.description, /Pokemon1 x2/);
  assert.equal(embed.author.name, 'Trainer');
  assert.equal(embed.color, 0xffcb05);
  assert.equal(embed.thumbnail.url, 'attachment://pokedex.png');
  assert.equal(embed.footer.text, '21 / 1.025 - Página 1 / 3');
  assert.equal(payload.files[0].name, 'pokedex.png');
});

test('owner can move forward and wrap back with no additional database requests', async () => {
  const f = fixture();
  await f.manager.showPokedex(f.message);
  const buttons = f.edits[0].components[0].toJSON().components;
  const next = f.interaction(buttons[1].custom_id);
  await f.manager.handlePokedexButton(next);
  assert.match(next.updated.embeds[0].data.footer.text, /Página 2 \/ 3/);
  assert.match(next.updated.embeds[0].data.description, /Pokemon11/);
  const prev = f.interaction(buttons[0].custom_id);
  await f.manager.handlePokedexButton(prev);
  assert.match(prev.updated.embeds[0].data.footer.text, /Página 3 \/ 3/);
  assert.equal(prev.updated.embeds[0].data.description.split('\n').length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(next.updated.files, undefined); // retain the existing thumbnail attachment
});

test('another user, another guild, and another message cannot navigate the collection', async () => {
  const f = fixture();
  await f.manager.showPokedex(f.message);
  const id = f.edits[0].components[0].toJSON().components[1].custom_id;
  for (const override of [{ user: { id: 'other' } }, { guildId: 'other' }, { message: { id: 'other' } }]) {
    const click = f.interaction(id, override);
    await f.manager.handlePokedexButton(click);
    assert.equal(click.updated, undefined);
    assert.equal(click.replied.flags, MessageFlags.Ephemeral);
    assert.match(click.replied.content, /otra persona/);
  }
});

test('empty and single-page collections have disabled navigation', async () => {
  for (const count of [0, 1, 10]) {
    const f = fixture(count);
    await f.manager.showPokedex(f.message);
    assert.ok(f.edits[0].components[0].toJSON().components.slice(0,2).every(c => c.disabled));
    assert.equal(new Set(f.edits[0].components[0].toJSON().components.map(c => c.custom_id)).size, 3);
    if (!count) assert.match(f.edits[0].embeds[0].data.description, /Todavía no/);
  }
});

test('pokedex sorts regular and shiny groups alphabetically and shows exact copy IVs',async()=>{
  const f=fixture(4);
  Object.assign(f.entries[0],{name:'zubat',isShiny:true});
  Object.assign(f.entries[1],{name:'absol',isShiny:true});
  Object.assign(f.entries[2],{name:'zubat',isShiny:false});
  Object.assign(f.entries[3],{name:'absol',isShiny:false});
  await f.manager.showPokedex(f.message);
  const lines=f.edits[0].embeds[0].data.description.split('\n');
  assert.match(lines[0],/Absol/);assert.match(lines[1],/Zubat/);
  assert.match(lines[2],/^✨ .*Absol/);assert.match(lines[3],/^✨ .*Zubat/);
  const click=f.interaction(f.edits[0].components[0].components[2].data.custom_id);
  await f.manager.handlePokedexButton(click);
  assert.match(click.updated.embeds[0].data.description,/Lv. 10 · \*\*IV 100.00%/);
  assert.match(click.updated.embeds[0].data.description,/HP 31 · ATK 31 · DEF 31 · SpA 31 · SpD 31 · SPE 31/);
  assert.equal(f.reads.length,1);
});

test('expired sessions and forged page numbers respond privately', async () => {
  const f = fixture();
  await f.manager.showPokedex(f.message);
  const id = f.edits[0].components[0].toJSON().components[1].custom_id;
  const forged = f.interaction(id.replace(/:\d+:/, ':99999:'));
  await f.manager.handlePokedexButton(forged);
  assert.match(forged.replied.content, /no válida/);
  f.expire();
  const expired = f.interaction(id);
  await f.manager.handlePokedexButton(expired);
  assert.match(expired.replied.content, /expiró/);
  assert.equal(expired.replied.flags, MessageFlags.Ephemeral);
});
