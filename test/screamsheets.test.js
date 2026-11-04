const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectLibrary } = require('../server/projects');
const { createDisplay } = require('../server/display');

const model = () => import('../app/screamsheets/screamsheet-model.js');
const gen = () => import('../app/screamsheets/generator.js');

// A made-up pack in the importer's shape (no real table text).
const PACK = {
  id: 'test', name: 'Test', articleTypes: [{
    id: 'news', name: 'News', rolls: [1, 2, 3, 4, 5, 6],
    intros: ['[Name 1] was seen at [Location (Neighborhood)].', 'b', 'c', 'd', 'e', 'f'],
    bodies: ['Body [Group 1].', 'b', 'c', 'd', 'e', 'f'],
    conclusions: [{ text: 'The end.', headlines: ['N1'] }, { text: 'x', headlines: 'any' }, { text: 'x', headlines: 'any' }, { text: 'x', headlines: 'any' }, { text: 'x', headlines: 'any' }, { text: 'x', headlines: 'any' }],
    headlines: { N1: '[Name 1] STRIKES', N2: 'Other' },
  }],
};

test('the generator rolls, composes and fills articles', async () => {
  const G = await gen();
  const sixes = () => 1;
  const { selection, dice } = G.generate(PACK, {}, sixes);
  assert.deepEqual(selection, { typeId: 'news', intro: 0, body: 0, conclusion: 0, headline: 'N1' });
  assert.equal(dice.type, 1);
  const raw = G.compose(PACK, selection);
  assert.deepEqual(G.fieldsIn(raw.headline, ...raw.paragraphs).map((f) => f.label), ['Name 1', 'Location (Neighborhood)', 'Group 1']);
  assert.equal(G.fill(raw.headline, { 'name 1': 'Wakako' }), 'Wakako STRIKES');
  assert.equal(G.fill('[Group 1]', {}), '[Group 1]', 'unfilled blanks stay bracketed');
  assert.deepEqual(G.fieldKind('Name 1'), { kind: 'people' });
  assert.deepEqual(G.fieldKind('Location (Neighborhood)'), { kind: 'places', district: true });
  assert.equal(G.fieldKind('Location Type').kind, 'choice');
  assert.equal(G.compose(PACK, { typeId: 'gone' }), null);
});

test('screamsheets are checked, stored per project, and pushed only when revealed', async () => {
  const M = await model();
  assert.throws(() => M.normalizeScreamsheet({ headline: ' ' }), /needs a headline/);
  const s = M.normalizeScreamsheet({ headline: ' Big news ', body: 'One\r\n\r\nTwo', layout: 'nope', mentions: ['char_0123abcd', 'bad'], values: { 'name 1': ' Wakako ' } });
  assert.deepEqual([s.headline, s.body, s.layout, s.revealed, s.mentions, s.values['name 1']], ['Big news', 'One\n\nTwo', 'broadsheet', false, ['char_0123abcd'], 'Wakako']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-ss-'));
  try {
    const lib = createProjectLibrary(dir);
    const proj = await lib.create({ name: 'Night City' });
    const stores = await lib.open(proj.id);
    const made = await stores.screamsheets.create({ headline: 'Gang war in Kabuki', body: 'Shots fired.', mentions: ['char_0123abcd'] });
    assert.match(made.id, /^ss_[0-9a-f]{8}$/);
    assert.equal((await stores.screamsheets.list()).length, 1);
    await assert.rejects(stores.screamsheets.get('ss_00000000'), (err) => err.status === 404 && /screamsheet/.test(err.message));

    const display = createDisplay(path.join(dir, 'display.json'), lib);
    await assert.rejects(display.push({ mode: 'article', project: proj.id, id: made.id }), (err) => err.status === 409, 'hidden: reveal first');
    await stores.screamsheets.save(made.id, { ...made, revealed: true });
    const d = await display.push({ mode: 'article', project: proj.id, id: made.id });
    assert.deepEqual([d.mode, d.title, d.article.body], ['article', 'Gang war in Kabuki', 'Shots fired.']);
    assert.equal('mentions' in d.article, false, 'players get the article as printed, nothing more');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
