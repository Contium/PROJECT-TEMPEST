import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/forge/preset-model.js';

const where = (p, id) => {
  const at = M.locate(p, id);
  return at.area === 'section' ? `${p.layout.sections.findIndex((s) => s.id === at.section)}:${at.column}:${at.index}` : `${at.area}:${at.index}`;
};

test('a new preset has the six fixed fields and nothing else', () => {
  const p = M.newPreset('Hero');
  assert.deepEqual(Object.keys(p.fields), ['category', 'image', 'name', 'species', 'size', 'summary']);
  assert.equal(p.fields.category.default, 'npc');
  assert.deepEqual(M.CATEGORIES.map((c) => c.label), ['Player', 'NPC', 'Monster', 'Creature']);
  assert.equal(p.fields.image.primary, true);
  assert.equal(p.fields.size.default, 'Medium');
  assert.deepEqual(p.layout, { main: [], sections: [] });
  assert.deepEqual(M.SIZES, ['Miniscule', 'Nano', 'Tiny', 'Small', 'Medium', 'Large', 'Giant', 'Gargantuan', 'Colossal']);
  assert.throws(() => M.removeField(p, 'name'), /cannot be removed/);
});

test('fields are added, moved between main, sections and columns, and removed', () => {
  let p = M.newPreset('Hero');
  let r = M.addField(p, 'stat');
  p = r.preset;
  const hp = r.id;
  r = M.addField(p, 'longtext');
  p = r.preset;
  const bio = r.id;
  assert.deepEqual(p.layout.main, [hp, bio]);

  r = M.addSection(p, 'Combat');
  p = r.preset;
  const combat = r.id;
  p = M.setColumns(p, combat, 3);
  p = M.moveField(p, hp, { area: 'section', section: combat, column: 2 });
  assert.equal(where(p, hp), '0:2:0');
  assert.deepEqual(p.layout.main, [bio]);

  // Two columns: whatever was in the third joins the second.
  p = M.setColumns(p, combat, 2);
  assert.equal(where(p, hp), '0:1:0');

  p = M.moveField(p, bio, { area: 'section', section: combat, column: 1 }, 0);
  assert.deepEqual(p.layout.sections[0].columns, [[], [bio, hp]]);
  p = M.nudgeField(p, bio, 1);
  assert.deepEqual(p.layout.sections[0].columns[1], [hp, bio]);
  p = M.nudgeField(p, bio, 1);
  assert.deepEqual(p.layout.sections[0].columns[1], [hp, bio], 'already last');

  p = M.removeField(p, hp);
  assert.equal(p.fields[hp], undefined);
  p = M.removeSection(p, combat);
  assert.equal(p.fields[bio], undefined, 'a section takes its fields with it');
  assert.deepEqual(Object.keys(p.fields), M.DEFAULT_IDS);
});

test('every addable type starts with sensible settings', () => {
  const types = Object.fromEntries(M.addableOf('characters').map((a) => [a.type, M.newField(a.type)]));
  assert.equal(types.parent.parentType, 'character');
  assert.deepEqual([types.gallery.mode, types.gallery.autoplay, types.gallery.cols, types.gallery.rows], ['slideshow', false, 2, 2]);
  assert.deepEqual(types.stat.default, { value: 10, max: 10 });
  assert.equal(types.stat.rarities.length, 5);
  for (const f of Object.values(types)) assert.equal(f.visibility, 'revealed');
});

test('normalize repairs layouts and clamps values', () => {
  const p = M.newPreset('Hero');
  const { preset, id } = M.addField(p, 'stat');
  const raw = structuredClone(preset);
  raw.fields[id] = { ...raw.fields[id], stat: 'pool', default: { value: 50, max: 20 }, visibility: 'sneaky', extra: 'dropped' };
  raw.fields.f_orphan = { ...M.newField('longtext'), id: 'f_orphan', label: 'Orphan' };
  raw.layout.main.push(id, 'name', 'f_missing'); // duplicate, default field, unknown
  raw.layout.sections.push({ id: 's_one', title: 'Gear', columns: [[], [], [], []] });
  raw.fields.size.default = 'Enormous';
  raw.fields.category.default = 'dragon';
  delete raw.fields.image; // presets from before a default field existed gain it
  const clean = M.normalizePreset(raw);
  assert.deepEqual(clean.layout.main, [id, 'f_orphan'], 'duplicates, defaults and missing ids dropped; orphans kept');
  assert.equal(clean.layout.sections[0].columns.length, 3);
  assert.deepEqual(clean.fields[id].default, { value: 20, max: 20 }, 'a pool cannot exceed its limit');
  assert.equal(clean.fields[id].visibility, 'revealed');
  assert.equal('extra' in clean.fields[id], false);
  assert.equal(clean.fields.size.default, 'Medium');
  assert.equal(clean.fields.category.default, 'npc', 'Category always has one of the four values');
  assert.equal(clean.fields.image.primary, true);
});

test('flexible pools may exceed their limit; rarities are the user\'s own', () => {
  let p = M.newPreset('Hero');
  let r = M.addField(p, 'stat');
  p = M.updateField(r.preset, r.id, { stat: 'flex', default: { value: 14, max: 10 } });
  assert.deepEqual(M.normalizePreset(p).fields[r.id].default, { value: 14, max: 10 });

  p = M.updateField(p, r.id, {
    stat: 'rarity',
    rarities: [{ name: 'Junk', color: '#777777', style: 'plain' }, { name: 'Relic', color: 'red', style: 'blink' }],
    default: { rarity: 'relic' },
  });
  const f = M.normalizePreset(p).fields[r.id];
  assert.deepEqual(f.rarities, [{ id: 'junk', name: 'Junk', color: '#777777', style: 'plain' }, { id: 'relic', name: 'Relic', color: '#a9b1bb', style: 'plain' }]);
  assert.deepEqual(f.default, { rarity: 'relic' });
});

test('broken imports are refused with reasons', () => {
  assert.throws(() => M.normalizePreset('nope'), /JSON object/);
  assert.throws(() => M.normalizePreset({ format: 'something-else', name: 'X' }), /not a TEMPEST preset/);
  assert.throws(() => M.normalizePreset({ format: M.PRESET_FORMAT, name: '' }), /needs a name/);
  assert.throws(() => M.normalizePreset({ format: M.PRESET_FORMAT, version: 99, name: 'Future' }), /newer TEMPEST/);
  const bad = M.newPreset('Hero');
  bad.fields.f_weird = { id: 'f_weird', type: 'laser', label: 'Laser' };
  bad.layout.main.push('f_weird');
  assert.throws(() => M.normalizePreset(bad), (err) => err.problems.length === 1 && /unknown type "laser"/.test(err.message));
});

test('a preset survives a round trip through JSON unchanged', () => {
  let p = M.newPreset('Round trip');
  for (const a of M.addableOf(p)) p = M.addField(p, a.type).preset;
  p = M.addSection(p, 'Lower').preset;
  p = M.updateField(p, 'summary', { visibility: 'shown', shown: 'A stranger in a long coat.' });
  p = M.updateField(p, 'species', { visibility: 'rumored', rumor: { style: 'text', text: 'Unknown origin' }, references: true });
  const once = M.normalizePreset(p);
  assert.deepEqual(M.normalizePreset(JSON.parse(JSON.stringify(once))), once);
});
