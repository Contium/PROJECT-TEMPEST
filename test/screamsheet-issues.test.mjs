// Screamsheets as issues: a lead article plus more articles and ads, Link lines, notes,
// sections, and what the players' copy keeps of each piece.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScreamsheet, playerCopy, articlesOf, parseLinks, parseNotes, linksText, notesText, monogram, SECTIONS, LAYOUTS, PICTURE_SPOTS } from '../app/screamsheets/screamsheet-model.js';

const issue = (extra = {}) => normalizeScreamsheet({
  headline: 'New Arms Race: Construction?', body: 'Lead text.', outlet: 'Night City Today', byline: 'Ziggy', dateline: '4:52 PM',
  layout: 'feed', section: 'local', revealed: true,
  links: [{ text: 'Night City Restoration Committee' }, { text: 'Padre', ref: 'char_00000001' }],
  notes: [{ label: 'Correction', text: 'It was Tuesday.' }],
  mentions: ['char_00000002'],
  items: [
    { type: 'article', headline: 'The Big Reopen', body: 'Ad copy as news.', byline: 'Harry', links: ['Gunfight at the Strip Club'], selection: { typeId: 'x' }, mentions: ['char_00000003'] },
    { type: 'ad', image: 'img_0123456789abcdef01234567', tagline: 'LITTLE DETECTIVE · BIG GUN', links: [{ text: 'Danger Gal' }] },
    { type: 'article', headline: 'Secret Memo', body: 'Shh.', hidden: true },
    { type: 'article', headline: 'Faisal\'s Customs', body: 'Guns.', parts: { byline: { visibility: 'hidden' }, body: { visibility: 'rumored', style: 'static' }, outlet: { visibility: 'hidden' } }, notes: [{ label: 'Disclaimer', text: 'Not responsible.' }] },
  ],
  ...extra,
});

test('a screamsheet from before issues is an issue with nothing else on its page', () => {
  const old = normalizeScreamsheet({ headline: 'Blades in Watson', body: 'x', outlet: 'NCT', layout: 'broadsheet', revealed: true });
  assert.deepEqual(old.items, []);
  assert.deepEqual(old.links, []);
  assert.deepEqual(old.notes, []);
  assert.equal(old.section, '');
  assert.equal(old.layout, 'broadsheet');
  assert.deepEqual(playerCopy(old).items, []);
  assert.ok(LAYOUTS.some((l) => l.id === 'feed'));
  assert.equal(SECTIONS.length, 8);
});

test('pieces are checked: articles need headlines, ads a picture or tagline; ids are unique', () => {
  const s = issue();
  assert.equal(s.items.length, 4);
  assert.ok(s.items.every((it) => /^it_[0-9a-f]{6}$/.test(it.id)));
  assert.equal(new Set(s.items.map((it) => it.id)).size, 4);
  assert.deepEqual(s.items[0].links, [{ text: 'Gunfight at the Strip Club' }], 'a link may be plain text');
  assert.deepEqual(s.items[3].parts, { byline: { visibility: 'hidden' }, body: { visibility: 'rumored', style: 'static', text: '' } }, 'a piece has no outlet of its own');
  assert.throws(() => normalizeScreamsheet({ headline: 'x', items: [{ type: 'article' }] }), /Article 2 needs a headline/);
  assert.throws(() => normalizeScreamsheet({ headline: 'x', items: [{ type: 'ad' }] }), /Ad 2 needs a picture or a tagline/);
  const dup = normalizeScreamsheet({ headline: 'x', items: [{ id: 'it_aaaaaa', type: 'ad', tagline: 'a' }, { id: 'it_aaaaaa', type: 'ad', tagline: 'b' }] });
  assert.notEqual(dup.items[0].id, dup.items[1].id);
  assert.deepEqual(articlesOf(s).map((a) => a.headline), ['New Arms Race: Construction?', 'The Big Reopen', 'Secret Memo', 'Faisal\'s Customs']);
});

test('the players\' copy: no hidden pieces, no generator state, links only to known entries', () => {
  const copy = playerCopy(issue(), { known: new Set(['char_00000001']) });
  assert.deepEqual(copy.items.map((it) => it.headline ?? it.tagline), ['The Big Reopen', 'LITTLE DETECTIVE · BIG GUN', 'Faisal\'s Customs']);
  assert.ok(!JSON.stringify(copy).includes('Secret Memo'), 'a hidden piece never leaves');
  assert.ok(!JSON.stringify(copy).includes('char_00000002') && !JSON.stringify(copy).includes('char_00000003'), 'mentions stay with the GM');
  assert.ok(!('selection' in copy.items[0]));
  assert.deepEqual(copy.links, [{ text: 'Night City Restoration Committee' }, { text: 'Padre', ref: 'char_00000001' }]);
  assert.deepEqual(playerCopy(issue()).links[1], { text: 'Padre' }, 'an unknown entry: just the words');
  const faisal = copy.items[2];
  assert.equal(faisal.byline, '');
  assert.equal(faisal.body, '');
  assert.deepEqual(faisal.hidden, ['byline']);
  assert.deepEqual(faisal.obscured, { body: { style: 'static' } });
  assert.deepEqual(faisal.notes, [{ label: 'Disclaimer', text: 'Not responsible.' }]);
  assert.equal(copy.items[1].image, 'img_0123456789abcdef01234567');
  assert.equal(copy.section, 'local');
});

test('an article\'s picture goes before or after its text, and can be kept from players', () => {
  const pic = 'img_aaaaaaaaaaaaaaaaaaaaaaaa';
  const s = normalizeScreamsheet({
    headline: 'Lead', image: pic, caption: 'Block 12', imagePos: 'after',
    items: [
      { type: 'article', headline: 'Two', image: pic, imagePos: 'sideways', parts: { image: { visibility: 'rumored', style: 'static' } } },
      { type: 'article', headline: 'Three', image: pic, caption: 'secret', parts: { image: { visibility: 'hidden' } } },
      { type: 'article', headline: 'Four', image: 'not-an-image' },
    ],
  });
  assert.deepEqual([s.image, s.caption, s.imagePos], [pic, 'Block 12', 'after']);
  assert.equal(s.items[0].imagePos, 'before', 'anything else goes before the text');
  assert.equal(s.items[2].image, null);
  const copy = playerCopy(s);
  assert.deepEqual([copy.image, copy.caption, copy.imagePos], [pic, 'Block 12', 'after']);
  assert.equal(copy.items[0].image, null, 'obscured: players know there is a picture, not what');
  assert.deepEqual(copy.items[0].obscured, { image: { style: 'static' } });
  assert.equal(copy.items[1].image, null);
  assert.deepEqual(copy.items[1].hidden, ['image']);
  assert.ok(!JSON.stringify(copy.items[1]).includes('secret'), 'nor its caption');
  assert.ok(PICTURE_SPOTS.length === 2);
});

test('Link and note lines, as the GM types them', () => {
  const entries = [{ id: 'char_00000001', name: 'Padre' }];
  assert.deepEqual(parseLinks('Link: Padre\nNight City Restoration Committee\n\n', entries), [{ text: 'Padre', ref: 'char_00000001' }, { text: 'Night City Restoration Committee' }]);
  assert.equal(linksText([{ text: 'A' }, { text: 'B' }]), 'A\nB');
  const notes = parseNotes('Disclaimer: Not responsible\nfor anything.\nCorrection: It was Tuesday.');
  assert.deepEqual(notes, [{ label: 'Disclaimer', text: 'Not responsible\nfor anything.' }, { label: 'Correction', text: 'It was Tuesday.' }]);
  assert.equal(notesText(notes), 'Disclaimer: Not responsible\nfor anything.\nCorrection: It was Tuesday.');
  assert.equal(monogram('Night City Today'), 'NCT');
  assert.equal(monogram('The Street Feed'), 'SF');
  assert.equal(monogram(''), 'S');
});
