// Factions (a kind of entry with Relations) and the Timeline (World › Timeline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, newPreset, normalizePreset, newField, cleanValue, RELATION_STANCES } from '../app/forge/preset-model.js';
import { forge, defaultValues, kindOfId, hrefOf } from '../app/forge/entity-model.js';
import { rosterEntry } from '../app/push/push-model.js';
import { compareDates, timelineEntries, layout, playerTimeline, MAX_LANES } from '../app/world/timeline-model.js';

test('factions: a kind of entry with types on one tab, an emblem, leader, headquarters and founding date', () => {
  const k = KINDS.factions;
  assert.equal(k.idPrefix, 'fac');
  assert.deepEqual(k.defaults.map((d) => d.id), ['category', 'image', 'name', 'leader', 'base', 'founded', 'summary']);
  assert.ok(k.categories.length >= 6 && k.categories.every((c) => c.tab === 'factions'), 'every type on the one Factions tab');
  assert.ok(k.addable.includes('relations') && KINDS.characters.addable.includes('relations') && !KINDS.stories.addable.includes('relations'));
  const p = normalizePreset(newPreset('Faction', 'factions'));
  const e = forge(p, { values: { ...defaultValues(p), name: 'Arasaka', category: 'corporation', founded: { y: 1915 } } });
  assert.equal(kindOfId(e.id), 'factions');
  assert.match(hrefOf(e), /^#\/world\/factions\/fac_[0-9a-f]{8}$/);
  assert.equal(newField('relations', 'characters').label, 'Affiliations', 'on a character it reads as affiliations');
});

test('Relations: each entry once, a known stance (else neutral), notes trimmed, junk dropped', () => {
  const f = newField('relations', 'factions');
  const v = cleanValue(f, { links: [
    { id: 'fac_00000001', stance: 'enemy', note: '  since the war  ' },
    { id: 'fac_00000001', stance: 'ally' },
    { id: 'char_00000002', stance: 'made-up' },
    { id: 'not an id', stance: 'ally' },
    null,
  ] }, 'factions');
  assert.deepEqual(v, { links: [{ id: 'fac_00000001', stance: 'enemy', note: 'since the war' }, { id: 'char_00000002', stance: 'neutral' }] });
  assert.equal(cleanValue(f, { links: [] }, 'factions'), undefined);
  assert.ok(RELATION_STANCES.some((s) => s.id === 'member'));
});

const story = (id, category, start, end, extra = {}) => ({ id, kind: 'stories', category, name: id, start, end, ...extra });

test('the timeline orders any calendar: year, then month, day and time; a year alone comes first', () => {
  assert.equal(compareDates({ y: 2045 }, { y: 2045, m: 1 }), -1);
  assert.equal(compareDates({ y: -20, m: 3 }, { y: 5 }), -1, 'negative years are earlier');
  assert.equal(compareDates({ y: 1, m: 40, d: 90 }, { y: 1, m: 41 }), -1, 'months and days as high as the calendar goes');
  assert.equal(compareDates({ y: 1, m: 1, d: 1, time: '09:00' }, { y: 1, m: 1, d: 1, time: '21:30' }), -1);
  const list = timelineEntries([
    story('b', 'event', { y: 2045, m: 3, d: 9 }, { y: 2045, m: 3, d: 9 }),
    story('a', 'rumor', { y: 2045, m: 3, d: 2 }, null),
    { id: 'f', kind: 'factions', category: 'gang', name: 'f', founded: { y: 2039 } },
    story('undated', 'story', null, null),
    { id: 'c', kind: 'characters', name: 'c' },
  ]);
  assert.deepEqual(list.map((e) => e.id), ['f', 'a', 'b'], 'factions by Founded; undated and other kinds left off');
  assert.deepEqual(list.map((e) => [e.track, e.span, e.ongoing]), [['faction', false, false], ['rumor', true, true], ['event', false, false]]);
  assert.deepEqual(timelineEntries(list.map((e) => ({ ...e, founded: e.start })), { tracks: ['faction'] }).map((e) => e.id), ['f']);
});

test('spans get lanes: overlapping ones side by side, a lane reused once its span ends', () => {
  const entries = timelineEntries([
    story('war', 'event', { y: 1 }, { y: 3 }),
    story('plague', 'event', { y: 2 }, { y: 2, m: 6 }),
    story('moment', 'story', { y: 2, m: 3 }, { y: 2, m: 3 }),
    story('later', 'event', { y: 2, m: 9 }, { y: 4 }),
    story('end', 'story', { y: 5 }, { y: 5 }),
  ]);
  const { years, lanes } = layout(entries);
  assert.equal(lanes, 2);
  const rows = years.flatMap((y) => y.rows);
  const at = (id) => rows.find((r) => r.entry.id === id);
  assert.equal(at('war').lane, 0);
  assert.equal(at('plague').lane, 1, 'overlaps the war: the next lane');
  assert.deepEqual(at('moment').lanes.map((s) => s && `${s.id}:${s.at}`), ['war:through', 'plague:end'], 'a moment inside both');
  assert.equal(at('later').lane, 1, 'the plague\'s lane, free again');
  assert.equal(at('later').lanes[1].at, 'only', 'over before the next row: drawn on its own row');
  assert.equal(at('war').lanes[0].at, 'start');
  assert.deepEqual(years.map((y) => y.year), [1, 2, 5]);
  const many = timelineEntries(Array.from({ length: MAX_LANES + 2 }, (_, i) => story(`s${i}`, 'event', { y: 1, m: i + 1 }, null)));
  assert.equal(layout(many).lanes, MAX_LANES, 'never more than MAX_LANES rails');
});

test('the players\' timeline: only what\'s in their Codex, with a date they may read, as each sheet allows', () => {
  const field = (id, type, label, visibility = 'revealed') => ({ id, type, label, visibility, shown: '', rumor: { style: 'redacted', text: '' } });
  const sheet = (vis = {}) => ({ fields: {
    category: field('category', 'category', 'Type', vis.category), name: field('name', 'text', 'Title', vis.name), image: field('image', 'image', 'Image'),
    summary: field('summary', 'shorttext', 'Summary'), start: field('start', 'date', 'Start', vis.start), end: field('end', 'date', 'End', vis.end),
  } });
  const e = (id, known, vis, values) => ({ id, kind: 'stories', category: 'event', known, sheet: sheet(vis), values: { name: id, category: 'event', ...values }, name: id });
  const out = playerTimeline([
    e('known', true, {}, { start: { y: 1 }, end: { y: 2 } }),
    e('secret', false, {}, { start: { y: 1 } }),
    e('undated-for-them', true, { start: 'hidden' }, { start: { y: 1 } }),
    e('nameless', true, { name: 'rumored' }, { start: { y: 3 } }),
    e('end-hidden', true, { end: 'hidden' }, { start: { y: 4 }, end: { y: 9 } }),
  ], rosterEntry);
  assert.deepEqual(out.map((x) => x.id), ['known', 'nameless', 'end-hidden']);
  assert.equal(out[1].name, null, 'a hidden name stays unknown');
  assert.equal(out[2].span, false, 'an end they may not read: just a moment');
  assert.equal(out[0].span, true);
});
