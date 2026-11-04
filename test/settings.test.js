const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');

const model = () => import('../app/projects/settings-model.js');

test('defaults: D&D money and no map system chosen yet', async () => {
  const S = await model();
  const s = S.normalizeSettings(undefined);
  assert.equal(s.money.mode, 'dnd');
  assert.equal(s.maps.mode, null);
  assert.deepEqual(S.currencies(s).map((c) => [c.name, c.value]), [['Copper', 1], ['Silver', 10], ['Electrum', 50], ['Gold', 100], ['Platinum', 1000]]);
  assert.deepEqual(S.MAP_MODES.map((m) => m.label), ['Planar', 'Planetary', 'Cartographer', 'Galactic']);
});

test('D&D amounts break into coins, largest first, without electrum', async () => {
  const S = await model();
  const s = S.defaultSettings();
  assert.equal(S.formatAmount(250, s), '2 gp 5 sp');
  assert.equal(S.formatAmount(12345, s), '12 pp 3 gp 4 sp 5 cp');
  assert.equal(S.formatAmount(0, s), '0 cp');
  assert.equal(S.formatAmount(-150, s), '-1 gp 5 sp');
  assert.equal(S.rate(S.DND_COINS[3], S.DND_COINS[0]), 100);
});

test('a single currency with a name, symbol and symbol position', async () => {
  const S = await model();
  const s = S.normalizeSettings({ money: { mode: 'single', single: { name: 'Eurodollar', symbol: '§', position: 'before' } } });
  assert.equal(S.formatAmount(1250, s), '§ 1,250');
  assert.equal(S.formatAmount(1250, { money: { mode: 'single', single: { name: 'Eurodollar', symbol: '§' } } }), '1,250 §');
  assert.equal(S.formatAmount(3, { money: { mode: 'single', single: { name: 'Credits', symbol: '' } } }), '3 Credits');
  assert.deepEqual(S.currencies(s), [{ id: 'single', name: 'Eurodollar', symbol: '§', value: 1 }]);
});

test('other: up to six currencies with conversion rates to the first', async () => {
  const S = await model();
  const custom = [
    { name: 'Chit', symbol: 'ch', value: 99 }, // the first is the base: always worth 1
    { name: 'Scrip', symbol: 'sc', value: 12 },
    { name: 'Bar', symbol: 'bar', value: 144 },
    { name: 'A', value: 2 }, { name: 'B', value: 3 }, { name: 'C', value: 4 }, { name: 'Seventh', value: 5 },
  ];
  const s = S.normalizeSettings({ money: { mode: 'custom', custom } });
  assert.equal(s.money.custom.length, 6, 'at most six');
  assert.equal(s.money.custom[0].value, 1);
  const three = S.normalizeSettings({ money: { mode: 'custom', custom: custom.slice(0, 3) } });
  assert.equal(S.formatAmount(170, three), '1 bar 2 sc 2 ch');
  assert.throws(() => S.normalizeSettings({ money: { custom: [{ name: 'Base' }, { name: 'Free', value: 0 }] } }), /value above 0/);
  assert.throws(() => S.normalizeSettings({ money: { custom: [{ name: '' }] } }), /needs a name/);
});

test('each mode keeps its setup when switching; bad values fall back', async () => {
  const S = await model();
  const s = S.normalizeSettings({ money: { mode: 'single', single: { name: 'Eurodollar', symbol: '§' }, custom: [{ name: 'Bit' }, { name: 'Crown', value: 100 }] }, maps: { mode: 'galactic' } });
  const back = S.normalizeSettings({ ...s, money: { ...s.money, mode: 'custom' } });
  assert.equal(back.money.single.name, 'Eurodollar');
  assert.deepEqual(back.money.custom.map((c) => c.name), ['Bit', 'Crown']);
  assert.equal(back.maps.mode, 'galactic');
  assert.equal(S.normalizeSettings({ money: { mode: 'barter' }, maps: { mode: 'hyperspace' } }).money.mode, 'dnd');
  assert.equal(S.normalizeSettings({ maps: { mode: 'hyperspace' } }).maps.mode, null);
});

test('projects keep their own settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-settings-'));
  try {
    const lib = createProjectLibrary(dir);
    const a = await lib.create({ name: 'Night City' });
    const b = await lib.create({ name: 'Moonhollow' });
    assert.equal(a.settings.money.mode, 'dnd');
    const saved = await lib.update(a.id, { settings: { money: { mode: 'single', single: { name: 'Eurodollar', symbol: '§' } }, maps: { mode: 'cartographer' } } });
    assert.equal(saved.settings.money.single.symbol, '§');
    assert.equal((await lib.get(a.id)).settings.maps.mode, 'cartographer');
    assert.equal((await lib.get(b.id)).settings.money.mode, 'dnd', 'other projects are unaffected');
    await assert.rejects(lib.update(a.id, { settings: { money: { custom: [] } } }), (err) => err.status === 400);

    // A project.json from before settings existed reads with the defaults.
    const file = path.join(dir, 'projects', b.id, 'project.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw.settings;
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.equal((await lib.get(b.id)).settings.money.mode, 'dnd');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
