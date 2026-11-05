// Cyberpunk RED net cards: ready-made net card presets (Combat › Netrunning › Card
// Forge) laid out the way the NET Architecture rules present each kind of node. They
// use only TEMPEST's own field types (mainly a Stat Block), so each is an ordinary
// preset once opened, free to change. No rules text is copied: the fields are empty
// for the GM to fill in from their own books.

import { newPreset, newField } from '../preset-model.js';

/** A field of an addable type with its id, label and settings. */
function field(type, id, label, extra = {}) {
  return { ...newField(type, 'netcards'), id, label, ...extra };
}

function preset(name, category, fields) {
  const p = newPreset(name, 'netcards');
  p.fields.category.default = category;
  for (const f of fields) {
    p.fields[f.id] = f;
    p.layout.main.push(f.id);
  }
  return p;
}

const stats = (...labels) => labels.map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label }));

export const blackIce = {
  id: 'cyberpunk-red-black-ice',
  kind: 'netcards',
  name: 'Cyberpunk RED: Black ICE',
  description: 'A Black ICE program: its class, the PER · SPD · ATK · DEF · REZ stat line, and its effect.',
  build: () => preset('Cyberpunk RED: Black ICE', 'ice', [
    field('stat', 'ice_class', 'Class', {
      stat: 'rarity',
      rarities: [
        { id: 'anti_personnel', name: 'Anti-Personnel', color: '#ff4d4d', style: 'glow' },
        { id: 'anti_program', name: 'Anti-Program', color: '#22c3d6', style: 'glow' },
      ],
      default: { rarity: 'anti_personnel' },
    }),
    field('statblock', 'ice_stats', 'Stats', { stats: stats('PER', 'SPD', 'ATK', 'DEF', 'REZ'), default: {} }),
    field('longtext', 'effect', 'Effect', { default: '' }),
  ]),
};

export const demon = {
  id: 'cyberpunk-red-demon',
  kind: 'netcards',
  name: 'Cyberpunk RED: Demon',
  description: 'A Demon that runs an architecture: REZ · Interface · NET Actions · Combat Number, and what it does.',
  build: () => preset('Cyberpunk RED: Demon', 'demon', [
    field('statblock', 'demon_stats', 'Stats', { stats: stats('REZ', 'Interface', 'NET Actions', 'Combat #'), default: {} }),
    field('longtext', 'effect', 'Effect', { default: '' }),
  ]),
};

export const node = {
  id: 'cyberpunk-red-net-node',
  kind: 'netcards',
  name: 'Cyberpunk RED: Password, File or Control Node',
  description: 'A floor that isn\'t a program: what it guards or holds, and what it controls. The contents stay hidden from players until you reveal them.',
  build: () => preset('Cyberpunk RED: Net Node', 'password', [
    field('longtext', 'effect', 'What it does', { default: '' }),
    field('longtext', 'contents', 'Contents', { default: '', visibility: 'rumored' }),
    field('longtext', 'controls', 'Controls', { default: '' }),
  ]),
};
