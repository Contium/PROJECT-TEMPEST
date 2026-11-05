// On-the-spot visibility: Hidden fields, the Encrypted style, and screamsheet parts
// the GM obscures or hides. Players' copies must never carry what's kept from them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreset, VISIBILITY, OBSCURITY } from '../app/forge/preset-model.js';
import { forge, defaultValues, normalizeEntity } from '../app/forge/entity-model.js';
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

test('cipher text is stable for a seed, so a redraw doesn\'t jump', () => {
  assert.equal(cipher(12, 42), cipher(12, 42));
  assert.notEqual(cipher(12, 42), cipher(12, 43));
  assert.equal(cipher(12, 1).length, 12);
});
