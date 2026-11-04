const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');

const withDir = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-projects-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const models = async () => ({
  P: await import('../app/forge/preset-model.js'),
  C: await import('../app/forge/entity-model.js'),
});

test('projects are created, listed, renamed and moved to the trash', () =>
  withDir(async (v1) => {
    const lib = createProjectLibrary(v1);
    assert.deepEqual(await lib.list(), []);
    await assert.rejects(lib.create({ name: '  ' }), /needs a name/);
    const cp = await lib.create({ name: 'Night City', description: 'Cyberpunk RED campaign', theme: 'cyberpunk-red' });
    const dnd = await lib.create({ name: 'Moonhollow', theme: 'not a theme!' });
    assert.match(cp.id, /^proj_[0-9a-f]{8}$/);
    assert.equal(dnd.theme, null, 'bad theme ids are dropped');
    assert.ok(fs.existsSync(path.join(v1, 'projects', cp.id, 'project.json')));

    await lib.get(cp.id, { touch: true }); // opening a project puts it first
    assert.deepEqual((await lib.list()).map((p) => p.name), ['Night City', 'Moonhollow']);

    const renamed = await lib.update(dnd.id, { name: 'Moonhollow Saga', theme: 'moontown' });
    assert.deepEqual([renamed.name, renamed.theme], ['Moonhollow Saga', 'moontown']);
    await assert.rejects(lib.update(dnd.id, { name: '' }), /needs a name/);

    await lib.remove(dnd.id);
    assert.deepEqual((await lib.list()).map((p) => p.name), ['Night City']);
    const trashed = fs.readdirSync(path.join(v1, 'trash'));
    assert.equal(trashed.length, 1, 'deleted projects are kept in the trash');
    assert.ok(trashed[0].startsWith(dnd.id));
    await assert.rejects(lib.open(dnd.id), (err) => err.status === 404);
    await assert.rejects(lib.open('../../etc'), (err) => err.status === 404);
  }));

test('each project keeps its own presets, characters and images', () =>
  withDir(async (v1) => {
    const { P, C } = await models();
    const lib = createProjectLibrary(v1);
    const a = await lib.create({ name: 'A' });
    const b = await lib.create({ name: 'B' });
    const sa = await lib.open(a.id);
    const sb = await lib.open(b.id);

    await sa.presets.create('characters', P.newPreset('Only in A'));
    await sa.characters.create(C.forge(P.newPreset('x'), { values: { name: 'Rook' } }));
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4e50000000049454e44ae426082', 'hex');
    const img = await sa.assets.add(png);

    assert.equal((await sa.presets.list('characters')).length, 1);
    assert.deepEqual(await sb.presets.list('characters'), []);
    assert.deepEqual(await sb.characters.list(), []);
    await assert.rejects(sb.assets.get(img.id), (err) => err.status === 404, 'images are per project too');

    const listed = Object.fromEntries((await lib.list()).map((p) => [p.name, p.counts]));
    assert.deepEqual(listed, { A: { characters: 1, stories: 0, items: 0, presets: 1 }, B: { characters: 0, stories: 0, items: 0, presets: 0 } });
  }));

test('data made before projects existed moves into a first project', () =>
  withDir(async (v1) => {
    fs.mkdirSync(path.join(v1, 'presets', 'characters'), { recursive: true });
    fs.writeFileSync(path.join(v1, 'presets', 'characters', 'preset_00000001.json'), '{}');
    fs.mkdirSync(path.join(v1, 'assets'));
    const lib = createProjectLibrary(v1);
    const [first] = await lib.list();
    assert.equal(first.name, 'First project');
    assert.ok(fs.existsSync(path.join(v1, 'projects', first.id, 'presets', 'characters', 'preset_00000001.json')));
    assert.ok(!fs.existsSync(path.join(v1, 'presets')), 'moved, not copied');
  }));

test('empty leftovers from before projects are simply tidied away', () =>
  withDir(async (v1) => {
    fs.mkdirSync(path.join(v1, 'presets', 'characters'), { recursive: true });
    fs.mkdirSync(path.join(v1, 'characters'));
    const lib = createProjectLibrary(v1);
    assert.deepEqual(await lib.list(), []);
    assert.ok(!fs.existsSync(path.join(v1, 'presets')));
    assert.ok(!fs.existsSync(path.join(v1, 'characters')));
  }));
