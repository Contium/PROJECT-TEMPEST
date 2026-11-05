import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/forge/preset-model.js';
import { forge, defaultValues } from '../app/forge/entity-model.js';
import { TEMPLATES, templatesFor } from '../app/forge/templates/index.js';
import * as CPR from '../app/forge/templates/cyberpunk-red-player.js';

test('every template passes the preset rules unchanged', () => {
  for (const t of TEMPLATES) {
    const raw = t.build();
    const clean = M.normalizePreset(raw); // throws on any problem
    assert.equal(clean.kind, t.kind, t.id);
    // Nothing silently dropped or trimmed: same fields, labels and layout.
    assert.deepEqual(Object.keys(clean.fields).sort(), Object.keys(raw.fields).sort(), `${t.id}: fields`);
    for (const [id, f] of Object.entries(raw.fields)) assert.equal(clean.fields[id].label, f.label, `${t.id}: label of ${id}`);
    assert.deepEqual(clean.layout, raw.layout, `${t.id}: layout`);
    // Room left to add fields of your own.
    assert.doesNotThrow(() => M.addField(clean, 'longtext'));
    assert.notEqual(t.build(), t.build(), 'each build is a fresh copy');
  }
  assert.deepEqual(templatesFor('characters').map((t) => t.id), ['cyberpunk-red-player']);
  assert.deepEqual(templatesFor('items'), []);
});

test('the Cyberpunk RED template follows the official character sheet', () => {
  const p = M.normalizePreset(CPR.build());
  const labels = M.fieldsInOrder(p).map((f) => f.label);

  assert.equal(p.fields.category.default, 'player');
  assert.equal(p.fields.name.label, 'Handle');
  assert.equal(p.fields.species.default, 'Human');

  const stats = p.layout.sections.find((s) => s.title === 'STATS').columns.flat().map((id) => p.fields[id].label.split(' ')[0]);
  assert.deepEqual(stats, ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP']);
  assert.equal(p.fields.cpr_luck.stat, 'pool');
  assert.equal(p.fields.cpr_emp.stat, 'pool');

  const skills = Object.keys(p.fields).filter((id) => id.startsWith('cpr_sk_'));
  assert.equal(skills.length, 66, 'all 66 skills on the sheet');
  assert.equal(p.layout.sections.filter((s) => s.title.endsWith('Skills (Skill Level)')).length, 9);
  for (const l of ['Pilot Air Vehicle (REF, ×2)', 'Martial Arts (DEX, ×2)', 'Concentration (WILL)', 'Language: Streetslang (INT)', 'Wardrobe & Style (COOL)', 'Electronics/Security Tech (TECH, ×2)']) {
    assert.ok(labels.includes(l), l);
  }

  // Derived numbers match a character with every STAT at 5.
  assert.deepEqual(p.fields.cpr_hp.default, { value: 35, max: 35 }); // 10 + 5 × ⌈(5 + 5) / 2⌉
  assert.deepEqual(p.fields.cpr_seriously_wounded.default, { value: 18 }); // ⌈35 / 2⌉
  assert.deepEqual(p.fields.cpr_death_save.default, { value: 5 }); // BODY
  assert.deepEqual(p.fields.cpr_humanity.default, { value: 50, max: 50 }); // EMP × 10

  // Cyberware is a body diagram, laid out like the sheet's skeleton page.
  const cyber = p.layout.sections.find((s) => s.id === 'cpr_s_cyberware');
  assert.equal(cyber.layout, 'body');
  const zone = (i) => cyber.columns[i].map((id) => p.fields[id].label);
  assert.deepEqual(zone(0), ['Cyberaudio Suite']);
  assert.deepEqual(zone(1), ['Right Cybereye', 'Right Cyberarm', 'Right Cyberleg']);
  assert.deepEqual(zone(2), ['Left Cybereye', 'Left Cyberarm', 'Left Cyberleg']);
  assert.deepEqual(zone(3), ['Neural Link']);
  assert.deepEqual(zone(4), ['Internal Cyberware', 'External Cyberware', 'Fashionware', 'Borgware']);

  assert.deepEqual(p.fields.cpr_role.rarities.map((r) => r.id), ['rockerboy', 'solo', 'netrunner', 'tech', 'medtech', 'media', 'exec', 'lawman', 'fixer', 'nomad']);
  for (const l of ['Weapons', 'Armor', 'Neural Link', 'Borgware', 'Cash (eb)', 'Improvement Points', 'Reputation', 'Family', 'Life Goals', 'Role-specific Lifepath', 'Critical Injuries', 'Addictions']) {
    assert.ok(labels.includes(l), l);
  }
});

test('a character made from the Cyberpunk RED template keeps its numbers', () => {
  const preset = M.normalizePreset(CPR.build());
  // As Create New does: the preset's defaults, then what was filled in.
  const c = forge(preset, { values: { ...defaultValues(preset), name: 'Forty', cpr_role: { rarity: 'rockerboy' }, cpr_body: { value: 3 }, cpr_hp: { value: 12, max: 40 }, cpr_sk_handgun: { value: 6 } } });
  assert.equal(c.category, 'player');
  assert.equal(c.values.name, 'Forty');
  assert.deepEqual(c.values.cpr_role, { rarity: 'rockerboy' });
  assert.deepEqual(c.values.cpr_body, { value: 3 });
  assert.deepEqual(c.values.cpr_hp, { value: 12, max: 40 });
  assert.deepEqual(c.values.cpr_sk_handgun, { value: 6 });
  assert.deepEqual(c.values.cpr_sk_tracking, { value: 0 }, 'untouched skills keep the default');
});
