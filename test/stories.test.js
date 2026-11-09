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

test('story presets have their own default fields, types and addable fields', async () => {
  const { P } = await models();
  const p = P.newPreset('Rumor mill', 'stories');
  assert.deepEqual(P.defaultIdsOf(p), ['category', 'image', 'name', 'start', 'end', 'summary']);
  assert.deepEqual([p.fields.category.label, p.fields.name.label, p.fields.start.type], ['Type', 'Title', 'date']);
  assert.equal(p.fields.category.default, 'event');
  assert.deepEqual(P.categoriesOf(p).map((c) => [c.label, c.tab]), [['Story', 'stories'], ['Rumor', 'rumors'], ['Event', 'events']]);
  assert.deepEqual(P.addableOf(p).map((a) => a.label), ['Parent', 'Long Description', 'Image', 'Gallery', 'Stat', 'Characters', 'Location']);
  assert.deepEqual(P.addableOf('characters').map((a) => a.type), ['parent', 'longtext', 'image', 'gallery', 'stat', 'statblock', 'relations'], 'characters gain Stat Blocks and Relations (their affiliations) too');
  assert.equal(P.addField(p, 'parent').preset.fields[P.addField(p, 'parent').id], undefined); // ids are fresh per call
  assert.equal(P.newField('parent', 'stories').parentType, 'any', 'a story\'s parent can be anything');
  assert.throws(() => P.addField(P.newPreset('x'), 'cast'), /can be added here/);

  // A character preset can't smuggle in story-only fields.
  const bad = P.newPreset('Smuggler');
  bad.fields.f_cast = { id: 'f_cast', type: 'cast', label: 'Cast' };
  bad.layout.main.push('f_cast');
  assert.throws(() => P.normalizePreset(bad), /can't be used in Characters\/Creatures presets/);
  assert.equal(P.normalizePreset({ ...p, fields: { ...p.fields, category: { ...p.fields.category, default: 'npc' } } }).fields.category.default, 'event', 'only the kind\'s own types');
});

test('dates are in-world: negative years, partial dates, ordering and display', async () => {
  const { P } = await models();
  assert.deepEqual(P.cleanDate({ y: 1492, m: 3, d: 14, time: '18:30' }), { y: 1492, m: 3, d: 14, time: '18:30' });
  assert.deepEqual(P.cleanDate({ y: -120 }), { y: -120 });
  assert.deepEqual(P.cleanDate({ y: 12, m: 0, d: 5 }), { y: 12 }, 'no day without a month');
  assert.deepEqual(P.cleanDate({ y: 12, m: 13, d: 40, time: '25:00' }), { y: 12, m: 13, d: 40 }, 'any calendar; bad times dropped');
  assert.equal(P.cleanDate({ y: 1.5 }), undefined);
  assert.equal(P.formatDate({ y: 1492, m: 3, d: 4, time: '07:05' }), '1492-03-04 07:05');
  assert.equal(P.formatDate({ y: -120 }), '-120');
  const sorted = [{ y: 2 }, { y: -5 }, { y: 2, m: 1 }, { y: 2, m: 1, d: 1, time: '09:00' }, { y: 2, m: 1, d: 1 }].sort(P.compareDates);
  assert.deepEqual(sorted.map(P.formatDate), ['-5', '2', '2-01', '2-01-01', '2-01-01 09:00']);
});

test('forging a story: combat sides, involved characters, locations, any-entity parent', async () => {
  const { P, E } = await models();
  let p = P.newPreset('Skirmish', 'stories');
  let r = P.addField(p, 'cast');
  p = P.updateField(r.preset, r.id, { mode: 'combat', sides: ['Claws', 'Maelstrom', 'NCPD', 'Too many'] });
  const fight = r.id;
  r = P.addField(p, 'cast');
  p = r.preset;
  const involved = r.id;
  r = P.addField(p, 'location');
  p = P.updateField(r.preset, r.id, { mode: 'obscure' });
  const where = r.id;
  r = P.addField(p, 'location');
  p = P.updateField(r.preset, r.id, { mode: 'indirect' });
  const proxy = r.id;
  r = P.addField(p, 'parent');
  p = r.preset;
  const parent = r.id;
  p = P.normalizePreset(p);
  assert.deepEqual(p.fields[fight].sides, ['Claws', 'Maelstrom', 'NCPD'], 'at most three sides');

  const story = E.forge(p, {
    values: {
      name: 'Night Market Brawl', category: 'event',
      start: { y: 2045, m: 8, d: 3, time: '23:00' }, end: null,
      [fight]: { sides: [{ faction: 'Tyger Claws', members: ['char_00000001', 'char_00000001', 'bad'] }, { name: 'Maelstrom gang', members: ['char_00000002'] }] },
      [involved]: { people: [{ id: 'char_00000003', note: '  Saw everything ' }, { id: 'char_00000003', note: 'dup' }, { id: 'nope' }] },
      [where]: { text: 'A smoky stall under the monorail' },
      [proxy]: { id: 'story_0000000a' },
      [parent]: { id: 'story_0000000b' },
    },
  });
  assert.match(story.id, /^story_[0-9a-f]{8}$/);
  assert.equal(story.kind, 'stories');
  assert.deepEqual(story.values.start, { y: 2045, m: 8, d: 3, time: '23:00' });
  assert.equal(story.values.end, undefined, 'no end date: ongoing');
  assert.deepEqual(story.values[fight].sides, [
    { name: 'Claws', faction: 'Tyger Claws', members: ['char_00000001'] },
    { name: 'Maelstrom gang', faction: '', members: ['char_00000002'] },
    { name: 'NCPD', faction: '', members: [] },
  ]);
  assert.deepEqual(story.values[involved], { people: [{ id: 'char_00000003', note: 'Saw everything' }] });
  assert.deepEqual(story.values[where], { text: 'A smoky stall under the monorail' });
  assert.deepEqual(story.values[proxy], { id: 'story_0000000a' });
  assert.deepEqual(story.values[parent], { id: 'story_0000000b' });
  assert.equal(E.hrefOf(story), `#/world/events/${story.id}`);
  assert.equal(E.kindOfId(story.id), 'stories');
  assert.throws(() => E.forge(p, { values: { name: '' } }), /needs a title/);
  assert.throws(() => E.normalizeEntity(story, { kind: 'characters' }), /not a character/);
});

test('a project stores stories beside characters, and lists every kind together', async () => {
  const { P, E } = await models();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempest-stories-'));
  try {
    const lib = createProjectLibrary(dir);
    const proj = await lib.create({ name: 'Night City' });
    const s = await lib.open(proj.id);
    await s.presets.create('stories', P.newPreset('Rumors', 'stories'));
    const rumor = await s.stories.create(E.forge(P.newPreset('Rumors', 'stories'), { values: { name: 'Ghost on the monorail', category: 'rumor', start: { y: 2045 } } }));
    await s.characters.create(E.forge(P.newPreset('Basic'), { values: { name: 'Rook' } }));
    assert.deepEqual((await s.stories.list({ category: 'rumor' })).map((x) => [x.name, x.kind, x.start]), [['Ghost on the monorail', 'stories', { y: 2045 }]]);
    assert.deepEqual(await s.stories.list({ category: 'event' }), []);
    await assert.rejects(s.stories.create(E.forge(P.newPreset('Basic'), { values: { name: 'Sneaky' } })), /not a story/);
    await assert.rejects(s.characters.get(rumor.id), (err) => err.status === 404, 'ids are per kind');
    const listed = (await lib.list())[0].counts;
    assert.deepEqual(listed, { characters: 1, stories: 1, items: 0, presets: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
