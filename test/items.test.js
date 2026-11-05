const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');

const models = async () => ({
  P: await import('../app/forge/preset-model.js'),
  E: await import('../app/forge/entity-model.js'),
});

test('item presets: default fields and the nine rarities', async () => {
  const { P } = await models();
  const p = P.newPreset('Loot', 'items');
  assert.deepEqual(P.defaultIdsOf(p), ['image', 'name', 'itemtype', 'rarity', 'summary']);
  const rarity = P.normalizePreset(p).fields.rarity;
  assert.equal(rarity.type, 'rarity');
  assert.deepEqual(rarity.rarities.map((r) => r.name), ['Very Common', 'Common', 'Uncommon', 'Rare', 'Super Rare', 'Exotic', 'Legendary', 'Fabled', 'Mythic']);
  assert.deepEqual(rarity.default, { rarity: 'very_common' }, 'starts on the first rarity');
  assert.deepEqual(P.addableOf(p).map((a) => a.type), ['parent', 'longtext', 'image', 'gallery', 'stat', 'statblock']);
  assert.equal(P.newField('parent', 'items').parentType, 'any', 'an item can belong to anything');
  assert.throws(() => P.removeField(p, 'rarity'), /cannot be removed/);

  // The preset's own rarity list: renamed and extended, and a default picked.
  const custom = P.normalizePreset(P.updateField(p, 'rarity', {
    rarities: [...rarity.rarities, { name: 'Cursed', color: '#4b0082', style: 'glow' }],
    default: { rarity: 'rare' },
  })).fields.rarity;
  assert.equal(custom.rarities.length, 10);
  assert.deepEqual(custom.rarities.at(-1), { id: 'cursed', name: 'Cursed', color: '#4b0082', style: 'glow' });
  assert.deepEqual(custom.default, { rarity: 'rare' });
});

test('forging an item, storing it, and listing it with its rarity', async () => {
  const { P, E } = await models();
  const preset = P.normalizePreset(P.addField(P.newPreset('Loot', 'items'), 'parent').preset);
  const parent = Object.values(preset.fields).find((f) => f.type === 'parent').id;
  const item = E.forge(preset, { values: { name: 'Mantis Blades', itemtype: 'Cyberware', rarity: { rarity: 'exotic' }, [parent]: { id: 'char_00000001' } } });
  assert.match(item.id, /^item_[0-9a-f]{8}$/);
  assert.equal(item.category, undefined, 'items have no category');
  assert.equal(E.hrefOf(item), `#/items/${item.id}`);
  assert.equal(E.kindOfId(item.id), 'items');
  assert.deepEqual(item.values.rarity, { rarity: 'exotic' });
  assert.deepEqual(item.values[parent], { id: 'char_00000001' });
  assert.deepEqual(E.forge(preset, { values: { name: 'Junk', rarity: { rarity: 'nonsense' } } }).values.rarity, { rarity: 'very_common' }, 'unknown rarities fall back');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-items-'));
  try {
    const lib = createProjectLibrary(dir);
    const proj = await lib.create({ name: 'Loot run' });
    const s = await lib.open(proj.id);
    await s.presets.create('items', preset);
    const saved = await s.items.create(item);
    const [listed] = await s.items.list();
    assert.deepEqual([listed.kind, listed.itemtype, listed.rarity], ['items', 'Cyberware', { id: 'exotic', name: 'Exotic', color: '#e0569a', style: 'glow' }]);
    assert.ok((await (async () => (await s.characters.list()).length === 0)()));
    const everything = await (await lib.open(proj.id)).items.get(saved.id);
    assert.equal(everything.name, 'Mantis Blades');
    assert.deepEqual((await lib.list())[0].counts, { characters: 0, stories: 0, items: 1, presets: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
