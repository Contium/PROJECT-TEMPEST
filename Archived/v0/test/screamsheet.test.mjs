import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, compose, fieldsIn, fill, fieldKey, fieldKind, memberSuggestions, headlineOptions, typeForRoll, roll } from '../app/generators/screamsheet.js';

// A tiny homebrew pack in the importer's format (not the official tables).
const rows = (prefix) => Array.from({ length: 6 }, (_, i) => `${prefix} ${i + 1} about [Name 1].`);
const pack = {
  articleTypes: [
    {
      id: 'news', name: 'News', rolls: [1, 2, 3],
      intros: rows('Intro'),
      bodies: ['[Group 1] hit [Location (Neighborhood)].\n\nThen [group 1] left.', ...rows('Body').slice(1)],
      conclusions: [
        { text: 'Ended badly for [Name 1].', headlines: ['N1'] },
        { text: 'Any ending.', headlines: 'any' },
        ...rows('Conclusion').slice(2).map((text) => ({ text, headlines: ['N2', 'N3'] })),
      ],
      headlines: { N1: '[Name 1] Down!', N2: 'Chaos in [Location (Neighborhood)]!', N3: 'Who Did It?' },
    },
    {
      id: 'ads', name: 'Ads', rolls: [4, 5, 6],
      intros: rows('Ad intro'), bodies: rows('Ad body'),
      conclusions: rows('Ad end').map((text) => ({ text, headlines: 'any' })),
      headlines: { A1: 'Help Wanted' },
    },
  ],
};

const fixed = (...values) => {
  const queue = [...values];
  return () => queue.shift();
};

test('Table A: the type roll picks the matching article type', () => {
  assert.equal(typeForRoll(pack, 2).id, 'news');
  assert.equal(typeForRoll(pack, 5).id, 'ads');
});

test('generate rolls type, three parts and a headline from the conclusion\'s suggestions', () => {
  const { selection, dice } = generate(pack, {}, fixed(1, 3, 1, 1, 1));
  assert.deepEqual(selection, { typeId: 'news', intro: 2, body: 0, conclusion: 0, headline: 'N1' });
  assert.deepEqual(dice, { type: 1, intro: 3, body: 1, conclusion: 1, headline: 1 });
});

test('kept choices are not rerolled; a kept headline must suit the conclusion', () => {
  const { selection, dice } = generate(pack, { typeId: 'news', intro: 4, body: 1, conclusion: 2, headline: 'N1' }, fixed(2));
  assert.equal(selection.intro, 4);
  assert.equal(selection.headline, 'N3', 'N1 does not suit conclusion 3, so the headline was rolled from N2/N3');
  assert.deepEqual(dice, { headline: 2 });
});

test('"any" offers every headline', () => {
  assert.deepEqual(headlineOptions(pack.articleTypes[0], 1), ['N1', 'N2', 'N3']);
  assert.deepEqual(headlineOptions(pack.articleTypes[0], 3), ['N2', 'N3']);
});

test('compose splits paragraphs; fields are unique across headline and text', () => {
  const sel = { typeId: 'news', intro: 0, body: 0, conclusion: 0, headline: 'N2' };
  const { headline, paragraphs } = compose(pack, sel);
  assert.equal(paragraphs.length, 4);
  const fields = fieldsIn(headline, ...paragraphs);
  assert.deepEqual(fields.map((f) => f.label), ['Location (Neighborhood)', 'Name 1', 'Group 1']);
});

test('fill replaces fields case-insensitively and leaves unfilled ones bracketed', () => {
  const values = { [fieldKey('Group 1')]: 'Maelstrom', [fieldKey('Name 1')]: '  ' };
  assert.equal(fill('[Group 1] and [group 1] met [Name 1].', values), 'Maelstrom and Maelstrom met [Name 1].');
  assert.equal(fieldKey('Group 2’s  members'), "group 2's members");
});

test('field kinds route to universe levels', () => {
  assert.deepEqual(fieldKind('Name 2').types, ['individual']);
  assert.equal(fieldKind('Law Enforcement Group').types[0], 'regional_faction');
  assert.deepEqual(fieldKind('Location (neighborhood)').types, ['community', 'region']);
  assert.equal(fieldKind('Location').types[0], 'place');
  assert.equal(fieldKind('Day of the Week').kind, 'choice');
  assert.equal(fieldKind('Adjective').kind, 'text');
  assert.ok(!fieldKind('Group 1').types.includes('nation'), 'random groups skip whole nations');
});

test('descriptive blanks get words, member blanks derive from their group', () => {
  assert.equal(fieldKind('Location Type').kind, 'choice');
  assert.equal(fieldKind('Location or Vehicle Type').kind, 'choice');
  assert.equal(fieldKind('Media Type').kind, 'choice');
  assert.deepEqual(fieldKind('members of Group 2'), { kind: 'members', group: 'group 2' });
  assert.deepEqual(fieldKind('Group 1’s members'), { kind: 'members', group: 'group 1' });
  assert.deepEqual(fieldKind('Group 2 member'), { kind: 'members', group: 'group 2' });
  assert.equal(memberSuggestions('Maelstrom')[0], 'Maelstrom members');
  assert.deepEqual(memberSuggestions(''), []);
});

test('roll stays within 1..sides', () => {
  for (let i = 0; i < 500; i++) {
    const r = roll(6);
    assert.ok(r >= 1 && r <= 6);
  }
});
