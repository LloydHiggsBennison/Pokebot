const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Collection } = require('discord.js');
const POKEMON_LIST = require('../data/pokemon.json');

function loadModule(relative, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const localRequire = name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: localRequire, module, exports: module.exports, __dirname: path.dirname(filename),
    __filename: filename, process, Buffer, performance, setTimeout, clearTimeout,
    setInterval, clearInterval, AbortSignal, fetch, URL,
    console: { log() {}, warn() {}, error() {} }, ...globals,
  }, { filename });
  return module.exports;
}

function emoji(name, index) {
  return { name, id: String(100000000000000000n + BigInt(index)),
    toString() { return `<:${name}:${this.id}>`; } };
}

function fakeClient() {
  const cache = new Collection(POKEMON_LIST.map(p => [String(p.id), emoji(`pkv2_${p.id}`, p.id)]));
  cache.set('badge', emoji('pk_new', 2000));
  const calls = { fetch: 0, create: 0 };
  const client = { application: { emojis: { cache,
    async fetch() { calls.fetch++; return cache; },
    async create({ name }) { calls.create++; const created = emoji(name, 3000 + calls.create); cache.set(created.id, created); return created; },
  } } };
  return { client, cache, calls };
}

function fakeDatabase() {
  const captures = [];
  const rolls = new Map();
  const settings = { puzzle_cooldown_seconds: 0 };
  return { captures, rolls, settings,
    async getGuildSettings() { return settings; },
    async getLastRoll(g, u) { return rolls.get(`${g}:${u}`) || 0; },
    async setLastRoll(g, u, now) { rolls.set(`${g}:${u}`, now); },
    async hasCapture(g, u, name) { return captures.some(p => p.guildId === g && p.userId === u && p.name === name); },
    async addCapture(g, u, name, id) { captures.push({ guildId: g, userId: u, name, id }); },
    async addCaptures(g, u, items) { for (const p of items) captures.push({ guildId: g, userId: u, name: p.name, id: p.id }); },
  };
}

function fakeMessage(client, user = 'user', guild = 'guild') {
  const sent = [];
  return { sent, content: '$p', guild: { id: guild, client, emojis: {
    create() { throw new Error('Guild emoji API must not be called'); },
    delete() { throw new Error('Guild emoji API must not be called'); },
  } }, author: { id: user, username: 'Trainer', bot: false },
    async reply(content) { sent.push(['reply', content]); },
    channel: { async send(content) { sent.push(['send', content]); } },
  };
}

function fixedRandom(outcome) {
  let first = true;
  const math = Object.create(Math);
  math.random = () => { if (first) { first = false; return outcome; } return 0.42; };
  return math;
}

module.exports = { loadModule, emoji, fakeClient, fakeDatabase, fakeMessage, fixedRandom, POKEMON_LIST };
