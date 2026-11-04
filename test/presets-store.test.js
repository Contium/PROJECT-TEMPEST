const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPresetStore } = require('../server/presets');

const withStore = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-presets-'));
  try {
    await fn(createPresetStore(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('presets are created, listed, saved and deleted as JSON files', () =>
  withStore(async (store, dir) => {
    const M = await import('../app/forge/preset-model.js');
    const draft = M.addField(M.newPreset('Space Marine'), 'stat').preset;
    const made = await store.create('characters', draft);
    assert.notEqual(made.id, draft.id, 'every create gets a fresh id');
    assert.ok(fs.existsSync(path.join(dir, 'characters', `${made.id}.json`)));

    const imported = await store.create('characters', made);
    assert.notEqual(imported.id, made.id, 'importing the same file twice makes two presets');

    const list = await store.list('characters');
    assert.deepEqual(list.map((x) => [x.name, x.fields]), [['Space Marine', 7], ['Space Marine', 7]]);

    const saved = await store.save('characters', made.id, { ...made, name: 'Void Marine' });
    assert.equal(saved.name, 'Void Marine');
    assert.equal(saved.createdAt, made.createdAt);
    assert.equal((await store.get('characters', made.id)).name, 'Void Marine');

    await store.remove('characters', imported.id);
    assert.equal((await store.list('characters')).length, 1);
    await assert.rejects(store.get('characters', imported.id), /No such preset/);
  }));

test('bad input is refused and never written', () =>
  withStore(async (store) => {
    await assert.rejects(store.create('characters', { name: '' }), (err) => err.status === 400 && /needs a name/.test(err.message));
    await assert.rejects(store.list('spells'), (err) => err.status === 404);
    await assert.rejects(store.get('characters', '../../etc'), (err) => err.status === 404);
    assert.deepEqual(await store.list('characters'), []);
  }));
