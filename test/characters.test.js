const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEntityStore } = require('../server/entities');
const { createAssetStore } = require('../server/assets');

const models = async () => ({
  P: await import('../app/forge/preset-model.js'),
  C: await import('../app/forge/entity-model.js'),
});

const withDir = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-chars-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// A 1×1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4e50000000049454e44ae426082', 'hex');

test('forging a character snapshots the preset and checks its values', async () => {
  const { P, C } = await models();
  let preset = P.newPreset('Edgerunner');
  let r = P.addField(preset, 'stat');
  preset = P.updateField(r.preset, r.id, { label: 'HP', default: { value: 30, max: 30 } });
  const hp = r.id;
  r = P.addField(preset, 'gallery');
  preset = r.preset;
  const gallery = r.id;
  preset = P.updateField(preset, 'species', { visibility: 'shown', shown: 'Looks human', references: true });
  preset = P.updateField(preset, 'category', { default: 'monster' });

  const values = { ...C.defaultValues(preset), name: '  Rook ', [hp]: { value: 50, max: 30 }, image: 'not-an-asset', [gallery]: [{ image: 'img_' + 'a'.repeat(24), label: 'Den' }, { image: 'bad' }] };
  const c = C.forge(preset, { values, shown: { species: 'A tall stranger', name: 'kept for later: not Shown yet', nope: 'no such field' }, refs: { species: ['char_00000001', 'char_00000001', 'nope', 'story_00000003'], name: ['char_00000002'] } });

  assert.match(c.id, C.idPattern('characters'));
  assert.equal(c.kind, 'characters');
  assert.equal(c.name, 'Rook');
  assert.equal(c.category, 'monster', 'the preset\'s category is the default');
  assert.deepEqual(c.values[hp], { value: 30, max: 30 }, 'a pool is clamped to its limit');
  assert.equal(c.values.image, undefined, 'only stored images are accepted');
  assert.deepEqual(c.values[gallery], [{ image: 'img_' + 'a'.repeat(24), label: 'Den' }]);
  assert.deepEqual(c.shown, { species: 'A tall stranger', name: 'kept for later: not Shown yet' }, 'Shown text is kept while its field is set otherwise (only for fields the sheet has)');
  assert.deepEqual(c.refs, { species: ['char_00000001', 'story_00000003'] }, 'references (to any kind) only on fields that allow them, deduplicated');
  assert.deepEqual(Object.keys(c.sheet.fields).sort(), Object.keys(preset.fields).sort());

  // Editing the preset afterwards doesn't touch the character's snapshot.
  const changed = P.removeField(preset, hp);
  assert.ok(c.sheet.fields[hp]);
  assert.ok(!changed.fields[hp]);

  assert.throws(() => C.forge(preset, { values: { name: '   ' } }), /needs a name/);
  assert.deepEqual(C.categoryForTab('npcs'), { kind: 'characters', category: P.CATEGORIES[1] });
  assert.equal(C.hrefOf(c), `#/characters/monsters/${c.id}`);
});

test('characters are stored, listed by category, saved and deleted', () =>
  withDir(async (dir) => {
    const { P, C } = await models();
    const store = createEntityStore(dir, 'characters');
    const preset = P.newPreset('Basic');
    const rook = await store.create(C.forge(preset, { values: { name: 'Rook', category: 'player', species: 'Human' } }));
    await store.create(C.forge(preset, { values: { name: 'Ganger', category: 'monster' } }));
    await store.create(C.forge(preset, { values: { name: 'Alley Cat', category: 'creature' } }));

    assert.deepEqual((await store.list()).map((x) => x.name), ['Alley Cat', 'Ganger', 'Rook']);
    assert.deepEqual((await store.list({ category: 'player' })).map((x) => [x.name, x.species]), [['Rook', 'Human']]);

    const moved = await store.save(rook.id, { ...rook, values: { ...rook.values, category: 'npc' } });
    assert.equal(moved.category, 'npc', 'changing Category moves it to another tab');
    assert.equal(moved.createdAt, rook.createdAt);
    assert.deepEqual(await store.list({ category: 'player' }), []);

    await store.remove(rook.id);
    await assert.rejects(store.get(rook.id), (err) => err.status === 404);
    await assert.rejects(store.create({ sheet: preset, values: {} }), (err) => err.status === 400 && /needs a name/.test(err.message));
    await assert.rejects(store.get('../secret'), (err) => err.status === 404);
  }));

test('images are stored once by content, and only real images are accepted', () =>
  withDir(async (dir) => {
    const store = createAssetStore(dir);
    const a = await store.add(PNG);
    const b = await store.add(PNG);
    assert.match(a.id, /^img_[0-9a-f]{24}$/);
    assert.equal(a.id, b.id);
    assert.equal(a.mime, 'image/png');
    assert.equal(fs.readdirSync(dir).length, 1);
    assert.deepEqual((await store.get(a.id)).data, PNG);
    await assert.rejects(store.add(Buffer.from('<svg onload="alert(1)"/>')), /Only PNG/);
    await assert.rejects(store.get('img_nope'), (err) => err.status === 404);
  }));
