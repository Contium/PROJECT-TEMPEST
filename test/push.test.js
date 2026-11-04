const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');
const { createDisplay } = require('../server/display');

const load = async () => ({
  M: await import('../app/push/push-model.js'),
  P: await import('../app/forge/preset-model.js'),
  E: await import('../app/forge/entity-model.js'),
});

/** A character preset with one field of each visibility. */
async function preset() {
  const { P } = await load();
  const p = P.newPreset('Test', 'characters');
  const secret = P.newField('longtext', 'characters');
  const rumor = P.newField('longtext', 'characters');
  const parent = P.newField('parent', 'characters');
  Object.assign(secret, { id: 'secret', label: 'Secret', visibility: 'shown', shown: 'A quiet past.' });
  Object.assign(rumor, { id: 'rumor', label: 'Rumor', visibility: 'rumored' });
  Object.assign(parent, { id: 'boss', label: 'Boss', visibility: 'revealed' });
  p.fields.secret = secret;
  p.fields.rumor = rumor;
  p.fields.boss = parent;
  p.layout.main.push('secret', 'rumor', 'boss');
  return P.normalizePreset(p);
}

test('push requests are checked; unknown modes and bad ids refused', async () => {
  const { M } = await load();
  assert.deepEqual(M.normalizePushRequest({ mode: 'ambient' }), { mode: 'ambient' });
  assert.equal(M.normalizePushRequest({ mode: 'message', text: ' Hi ', tone: 'nope' }).tone, 'info');
  assert.throws(() => M.normalizePushRequest({ mode: 'message', text: ' ' }), /needs some text/);
  assert.throws(() => M.normalizePushRequest({ mode: 'hack' }), /Unknown push/);
  assert.throws(() => M.normalizePushRequest({ mode: 'entity', id: 'char_0123abcd' }), /needs a project/);
  assert.throws(() => M.normalizePushRequest({ mode: 'entity', project: 'proj_0123abcd', id: '../x' }), /No such entry/);
  const g = M.normalizePushRequest({ mode: 'globe', project: 'proj_0123abcd', view: { lon: 500, lat: 10 }, zoom: 99 });
  assert.deepEqual([g.view.lon, g.zoom, g.focus], [180, 6, null]);
  assert.equal(M.pushKind('citymap'), 'map');
});

test('the players\' copy of an entry keeps only what its fields allow', async () => {
  const { M, E } = await load();
  const p = await preset();
  const e = { ...E.forge(p, { values: { name: 'Rogue', category: 'npc', secret: 'Ex-Arasaka', rumor: 'Owns the Afterlife', boss: { id: 'char_0000beef' } }, refs: { name: ['char_0000beef'] } }), id: 'char_0123abcd', kind: 'characters' };
  e.sheet.fields.name.default = 'GM default';
  const boss = { ...E.forge(p, { values: { name: 'Hidden Boss', category: 'npc' } }), id: 'char_0000beef', kind: 'characters' };
  boss.sheet.fields.name.visibility = 'rumored';
  const view = M.playerEntity(e, new Map([[boss.id, boss]]));
  assert.equal(view.name, 'Rogue');
  assert.equal(view.values.secret, undefined, 'Shown: the contents stay with the GM');
  assert.equal(view.shown.secret, 'A quiet past.', '…players read the shown text');
  assert.equal(view.values.rumor, undefined, 'Rumored: nothing');
  assert.equal(view.sheet.fields.rumor.default, undefined);
  assert.equal('refs' in view, false, 'no references');
  assert.deepEqual(view.links['char_0000beef'], { name: null, image: null }, 'a linked entry\'s rumored name stays hidden');
  assert.ok(!JSON.stringify(view).includes('Ex-Arasaka') && !JSON.stringify(view).includes('Owns the Afterlife') && !JSON.stringify(view).includes('Hidden Boss'));

  e.sheet.fields.name.visibility = 'rumored';
  e.sheet.fields.summary.visibility = 'shown';
  e.shown = { summary: 'A fixer.' };
  assert.deepEqual(M.rosterEntry(e), { id: e.id, name: null, image: null, summary: 'A fixer.' });
});

test('the display builds players\' copies and refuses hidden points', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-push-'));
  try {
    const { E } = await load();
    const lib = createProjectLibrary(dir);
    const proj = await lib.create({ name: 'Night City', settings: { maps: { mode: 'planetary' } } });
    const s = await lib.open(proj.id);
    const p = await preset();
    const rogue = await s.characters.create(E.forge(p, { values: { name: 'Rogue', category: 'npc', secret: 'Ex-Arasaka' } }));
    const display = createDisplay(path.join(dir, 'display.json'), lib);
    assert.equal(display.get().mode, 'ambient');

    const d = await display.push({ mode: 'entity', project: proj.id, id: rogue.id, theme: 'cyberpunk-red' });
    assert.deepEqual([d.mode, d.title, d.theme, d.seq, d.project], ['entity', 'Rogue', 'cyberpunk-red', 1, 'Night City']);
    assert.ok(!JSON.stringify(d).includes('Ex-Arasaka'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'display.json'), 'utf8')).all.seq, 1, 'kept on disk');

    const r = await display.push({ mode: 'roster', project: proj.id, kind: 'characters', category: 'npc' });
    assert.deepEqual([r.title, r.entries.map((x) => x.name)], ['NPCs', ['Rogue']]);

    const hidden = await s.pois.create({ name: 'Black Site', lon: 1, lat: 1 });
    await assert.rejects(display.push({ mode: 'poi', project: proj.id, id: hidden.id }), (err) => err.status === 409);
    const g = await display.push({ mode: 'globe', project: proj.id, view: { lon: -120, lat: 35 }, zoom: 2 });
    assert.deepEqual(g.pois.map((x) => x.name), ['Night City'], 'only revealed points reach the globe');

    const bar = await s.citypois.create({ city: 'nightcity', name: 'Afterlife', x: 0.5, y: 0.5, district: 'kabuki', revealed: true, refs: ['char_0123abcd'] });
    const c = await display.push({ mode: 'citypoi', project: proj.id, city: 'nightcity', id: bar.id });
    assert.deepEqual([c.title, c.districtName, c.poi.refs], ['Afterlife', 'Kabuki', []]);
    const m = await display.push({ mode: 'citymap', project: proj.id, city: 'nightcity', district: 'kabuki' });
    assert.equal(m.title, 'Night City · Kabuki');
    await assert.rejects(display.push({ mode: 'handout', project: proj.id, image: `img_${'a'.repeat(24)}` }), (err) => err.status === 404);
    assert.equal((await display.push({ mode: 'ambient' })).mode, 'ambient');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pushes go to every screen, or to named screens alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-push-'));
  try {
    const lib = createProjectLibrary(dir);
    const file = path.join(dir, 'display.json');
    const display = createDisplay(file, lib);
    const msg = (text, to) => display.push({ mode: 'message', text, ...(to ? { to } : {}) });

    // Screens make themselves known by asking under their name.
    assert.equal(display.get('Alex').mode, 'ambient');
    display.get('  Sam  ');
    display.get('Table TV');
    assert.deepEqual(display.screens().map((s) => [s.name, s.online]), [['Alex', true], ['Sam', true], ['Table TV', true]]);

    await msg('Everyone sees this');
    assert.equal(display.get('Alex').text, 'Everyone sees this');

    const secret = await msg('Only for you', ['alex', 'SAM', 'Alex']);
    assert.deepEqual(secret.to, ['Alex', 'SAM'], 'names match whatever their case, once each');
    assert.equal(display.get('Alex').text, 'Only for you');
    assert.equal(display.get('Sam').text, 'Only for you');
    assert.equal(display.get('Table TV').text, 'Everyone sees this', 'other screens keep what they had');
    assert.equal(display.get().text, 'Everyone sees this', 'the GM\'s "everyone" display is unchanged');
    assert.deepEqual(display.screens().filter((s) => s.personal).map((s) => s.name), ['Alex', 'Sam']);

    // A restart keeps who was sent what.
    const again = createDisplay(file, lib);
    assert.equal(again.get('Alex').text, 'Only for you');
    assert.equal(again.get('Table TV').text, 'Everyone sees this');
    const next = await again.push({ mode: 'message', text: 'And again' });
    assert.ok(next.seq > secret.seq, 'push numbers keep counting up across screens and restarts');

    // Pushing to everyone replaces what any one screen was sent.
    assert.equal(again.get('Alex').text, 'And again');
    assert.equal(again.screens().some((s) => s.personal), false);

    await assert.rejects(msg('Nobody', []), (err) => err.status === 400);
    await assert.rejects(msg('Nobody', ['   ']), (err) => err.status === 400);
    await assert.rejects(msg('Nobody', 'Alex'), (err) => err.status === 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an old display file (before named screens) still loads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-push-'));
  try {
    const file = path.join(dir, 'display.json');
    fs.writeFileSync(file, JSON.stringify({ mode: 'message', text: 'Old', tone: 'info', seq: 7 }));
    const display = createDisplay(file, createProjectLibrary(dir));
    assert.equal(display.get('Alex').text, 'Old');
    assert.equal((await display.push({ mode: 'ambient' })).seq, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
