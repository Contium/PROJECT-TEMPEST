// On-the-spot visibility: Hidden fields, the Encrypted style, and screamsheet parts
// the GM obscures or hides. Players' copies must never carry what's kept from them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreset, VISIBILITY, OBSCURITY } from '../app/forge/preset-model.js';
import { readFileSync } from 'node:fs';
import { forge, defaultValues, normalizeEntity, withAllFields, fieldsNotAt } from '../app/forge/entity-model.js';
import { playerEntity, rosterEntry } from '../app/push/push-model.js';
import { normalizeScreamsheet, playerCopy, playerTitle } from '../app/screamsheets/screamsheet-model.js';
import { build } from '../app/forge/templates/cyberpunk-red-player.js';
import { cipher } from '../app/forge/obscure.js';

test('Hidden and Encrypted are visibility choices every preset and entry accepts', () => {
  assert.ok(VISIBILITY.some((v) => v.id === 'hidden'));
  assert.ok(OBSCURITY.some((o) => o.id === 'encrypted'));
  const preset = build();
  preset.fields.cpr_notes.visibility = 'hidden';
  preset.fields.cpr_cash.visibility = 'rumored';
  preset.fields.cpr_cash.rumor = { style: 'encrypted', text: '' };
  const p = normalizePreset(preset);
  assert.equal(p.fields.cpr_notes.visibility, 'hidden');
  assert.equal(p.fields.cpr_cash.rumor.style, 'encrypted');
  assert.equal(normalizePreset({ ...preset, fields: { ...preset.fields, cpr_notes: { ...preset.fields.cpr_notes, visibility: 'nonsense' } } }).fields.cpr_notes.visibility, 'revealed');
});

test('a Hidden field reaches players not at all: no value, no label, no field', () => {
  const preset = build();
  const e = forge(preset, { values: { ...defaultValues(preset), name: 'Ghost', category: 'npc', cpr_notes: 'Secretly a Militech plant', summary: 'A fixer' } });
  // The GM hides two fields on this one entry only (as the entry page's menu does).
  const sheet = structuredClone(e.sheet);
  sheet.fields.cpr_notes.visibility = 'hidden';
  sheet.fields.summary.visibility = 'hidden';
  sheet.fields.name.visibility = 'rumored';
  sheet.fields.name.rumor = { style: 'encrypted', text: '' };
  const entry = normalizeEntity({ ...e, sheet });
  const copy = playerEntity(entry);
  assert.equal(copy.sheet.fields.cpr_notes, undefined, 'the field itself is gone');
  assert.equal(copy.values.cpr_notes, undefined);
  assert.ok(!JSON.stringify(copy).includes('Militech'));
  assert.ok(!Object.values(copy.sheet.fields).some((f) => f.label === 'Notes'), 'not even its label');
  assert.ok(!copy.sheet.layout.sections.some((s) => s.title === 'Notes'), 'and a section left empty loses its heading');
  assert.ok(copy.sheet.layout.sections.some((s) => s.title === 'STATS'), 'other sections stay');
  assert.equal(copy.name, null, 'an encrypted name stays unknown');
  assert.equal(copy.sheet.fields.name.rumor.style, 'encrypted');
  assert.deepEqual(rosterEntry(entry), { id: entry.id, name: null, image: entry.values.image ?? null, summary: '' });
});

test('screamsheet parts can be obscured or hidden; the printed copy keeps only how', () => {
  const s = normalizeScreamsheet({
    headline: 'Arasaka exec found dead', body: 'Para one.\n\nPara two.', outlet: 'Night City Today', byline: 'Wakako Okada', dateline: 'March 6',
    revealed: true,
    parts: { headline: { visibility: 'rumored', style: 'encrypted' }, byline: { visibility: 'hidden' }, body: { visibility: 'revealed' }, nope: { visibility: 'hidden' }, outlet: { visibility: 'rumored', style: 'text', text: '[SIGNAL LOST]' } },
  });
  assert.deepEqual(Object.keys(s.parts).sort(), ['byline', 'headline', 'outlet'], 'only obscured or hidden parts are kept');
  const copy = playerCopy(s);
  assert.equal(copy.headline, '');
  assert.equal(copy.byline, '');
  assert.equal(copy.body, 'Para one.\n\nPara two.');
  assert.deepEqual(copy.obscured, { headline: { style: 'encrypted' }, outlet: { style: 'text', text: '[SIGNAL LOST]' } });
  assert.deepEqual(copy.hidden, ['byline']);
  assert.ok(!JSON.stringify(copy).includes('Arasaka'));
  assert.ok(!JSON.stringify(copy).includes('Okada'));
  assert.equal(playerTitle(s), 'Screamsheet', 'a hidden headline never becomes the screen\'s title');
  assert.equal(playerTitle({ ...s, parts: {} }), 'Arasaka exec found dead');
});

test('a Hidden or Rumored name keeps its visibility control clickable (it floats above the faded name)', () => {
  // The faded name is drawn with opacity, which puts it in its own layer; without a z-index the
  // name covered its control and a hidden Name could never be revealed again.
  const css = readFileSync(new URL('../app/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\.sheet__label--float\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /z-index:\s*[1-9]/);
});

test('a hidden Name can be revealed and edited again, like any other field', () => {
  const preset = build();
  let e = forge(preset, { values: { ...defaultValues(preset), name: 'Ghost', category: 'npc' } });
  const set = (entry, vis) => {
    const sheet = structuredClone(entry.sheet);
    sheet.fields.name.visibility = vis;
    return normalizeEntity({ ...entry, sheet });
  };
  e = set(e, 'hidden');
  assert.equal(playerEntity(e).name, null);
  e = normalizeEntity({ ...e, values: { ...e.values, name: 'Ghost Two' } });
  assert.equal(e.name, 'Ghost Two', 'still editable while hidden');
  assert.equal(e.sheet.fields.name.visibility, 'hidden');
  e = set(e, 'revealed');
  assert.equal(playerEntity(e).name, 'Ghost Two');
});

test('Hide all: every field Hidden, nothing reaches players, Obscure styles and Shown text kept', () => {
  const preset = build();
  const e = forge(preset, { values: { ...defaultValues(preset), name: 'Ghost', category: 'npc', cpr_notes: 'Secretly a Militech plant', summary: 'A fixer' } });
  const sheet = structuredClone(e.sheet);
  sheet.fields.summary.visibility = 'shown';
  sheet.fields.cpr_notes.visibility = 'rumored';
  sheet.fields.cpr_notes.rumor = { style: 'encrypted', text: '' };
  const before = normalizeEntity({ ...e, sheet, shown: { summary: 'Someone you can trust' } });
  assert.ok(fieldsNotAt(before, 'hidden') > 0);

  const hidden = normalizeEntity(withAllFields(before, 'hidden'));
  assert.equal(fieldsNotAt(hidden, 'hidden'), 0, 'every field is Hidden');
  assert.equal(hidden.sheet.fields.cpr_notes.rumor.style, 'encrypted', 'the Obscure style waits for later');
  assert.equal(hidden.shown.summary, 'Someone you can trust', 'so does the Shown text');
  assert.equal(before.sheet.fields.name.visibility, 'revealed', 'the original is untouched');

  const copy = playerEntity(hidden);
  assert.deepEqual(copy.sheet.fields, {});
  assert.deepEqual(copy.values, {});
  assert.deepEqual(copy.shown, {});
  assert.equal(copy.name, null);
  assert.equal(copy.category, null);
  for (const secret of ['Ghost', 'Militech', 'fixer', 'trust']) assert.ok(!JSON.stringify(copy).includes(secret), `no "${secret}"`);
  assert.deepEqual(rosterEntry(hidden), { id: hidden.id, name: null, image: null, summary: '' });
});

test('Reveal all: every field Revealed, and a field switched back to Shown finds its words again', () => {
  const preset = build();
  const e = forge(preset, { values: { ...defaultValues(preset), name: 'Ghost', category: 'npc', summary: 'A fixer' } });
  const sheet = structuredClone(e.sheet);
  sheet.fields.summary.visibility = 'shown';
  sheet.fields.name.visibility = 'hidden';
  const before = normalizeEntity({ ...e, sheet, shown: { summary: 'Someone you can trust' } });

  const open = normalizeEntity(withAllFields(before, 'revealed'));
  assert.equal(fieldsNotAt(open, 'revealed'), 0);
  const copy = playerEntity(open);
  assert.equal(copy.name, 'Ghost');
  assert.equal(copy.values.summary, 'A fixer');
  assert.deepEqual(copy.shown, {}, 'Shown text never reaches players while its field is Revealed');

  // Undo puts each field's own setting back.
  const undone = structuredClone(open.sheet);
  for (const f of Object.values(undone.fields)) f.visibility = before.sheet.fields[f.id].visibility;
  const back = playerEntity(normalizeEntity({ ...open, sheet: undone }));
  assert.equal(back.name, null);
  assert.equal(back.shown.summary, 'Someone you can trust');
});

test('Hide all / Reveal all only set Hidden or Revealed', () => {
  const preset = build();
  const e = forge(preset, { values: { ...defaultValues(preset), name: 'Ghost', category: 'npc' } });
  assert.throws(() => withAllFields(e, 'rumored'));
  assert.throws(() => withAllFields(e, 'nonsense'));
  assert.equal(fieldsNotAt(withAllFields(e, 'revealed'), 'revealed'), 0);
});

test('cipher text is stable for a seed, so a redraw doesn\'t jump', () => {
  assert.equal(cipher(12, 42), cipher(12, 42));
  assert.notEqual(cipher(12, 42), cipher(12, 43));
  assert.equal(cipher(12, 1).length, 12);
});
