// Builds the demo campaign's factions (demo/projects/proj_91c43227): a "Cyberpunk Faction"
// preset, and the five powers the Static Saints run into, tied to each other and to the
// campaign's characters with Relations, and founded on dates that put them on the Timeline.
// Ids are fixed, so a rebuild replaces rather than duplicates. Run it again after editing.
//
//   node scripts/build-faction-demo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePreset, newPreset } from '../app/forge/preset-model.js';
import { normalizeEntity, defaultValues } from '../app/forge/entity-model.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'demo', 'projects', 'proj_91c43227');
const write = (rel, data) => {
  const file = path.join(PROJECT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
const STAMP = '2026-11-06T12:00:00.000Z';

// --- the preset ------------------------------------------------------------------------------

const base = newPreset('Cyberpunk Faction', 'factions');
const field = (id, type, label, extra = {}) => ({ id, type, label, visibility: 'revealed', shown: '', rumor: { style: 'redacted', text: '' }, references: false, ...extra });
const preset = normalizePreset({
  ...base,
  id: 'preset-cpr-faction',
  createdAt: STAMP, updatedAt: STAMP,
  fields: {
    ...base.fields,
    fx_goals: field('fx_goals', 'longtext', 'What they want', { default: '' }),
    fx_assets: field('fx_assets', 'longtext', 'Resources & Turf', { default: '' }),
    fx_relations: field('fx_relations', 'relations', 'Relations'),
    fx_members: field('fx_members', 'cast', 'Known Members', { mode: 'involved', sides: ['Side A', 'Side B'] }),
    fx_secret: field('fx_secret', 'longtext', 'What\'s Really Going On', { visibility: 'rumored', rumor: { style: 'encrypted', text: '' }, default: '' }),
  },
  layout: {
    main: [],
    sections: [
      { id: 'fs_who', title: 'Who They Are', layout: 'columns', columns: [['fx_goals'], ['fx_assets']] },
      { id: 'fs_ties', title: 'Ties', layout: 'columns', columns: [['fx_relations'], ['fx_members']] },
      { id: 'fs_gm', title: 'GM Notes', layout: 'columns', columns: [['fx_secret']] },
    ],
  },
});
write('presets/factions/preset-cpr-faction.json', preset);
console.log(`preset: ${preset.name}`);

// --- the factions --------------------------------------------------------------------------------

const SAINTS = 'fac_5ee40001';
const VULTURES = 'fac_5ee40002';
const HALCYON = 'fac_5ee40003';
const TASKFORCE = 'fac_5ee40004';
const SITE9 = 'fac_5ee40005';
const people = (...list) => ({ people: list.map(([id, note]) => ({ id, ...(note ? { note } : {}) })) });
const ties = (...list) => ({ links: list.map(([id, stance, note]) => ({ id, stance, ...(note ? { note } : {}) })) });

const FACTIONS = [
  {
    id: SAINTS, known: true, category: 'other', name: 'The Static Saints', leader: 'No one, officially', base: 'A safehouse in Kabuki', founded: { y: 2043, m: 9 },
    summary: 'Five edgerunners who keep saving each other\'s lives and calling it business.',
    fx_goals: 'Get paid, stay alive, and get Brick\'s family out of the Rancho Coronado camp.',
    fx_assets: 'A van registered to a dead man, a netrunner who never sleeps, and favours owed by Mama Ndiaye.',
    fx_relations: ties([VULTURES, 'enemy', 'Ever since Vulture Season'], [HALCYON, 'wary', 'Their money is good. Their jobs go wrong.'], [TASKFORCE, 'rival', 'Hammerhead wants Brick back in a cell']),
    fx_members: people(['char_c2806906', 'Solo'], ['char_3a87e3ae', 'Solo'], ['char_3de62be7', 'Netrunner'], ['char_52757f33', 'Nomad'], ['char_ce151765', 'Medtech']),
  },
  {
    id: VULTURES, known: true, category: 'gang', name: 'Chrome Vultures', leader: 'Rafael "Razor" Sosa', base: 'Chrome Vultures Salvage Yard, Santo Domingo', founded: { y: 2039 },
    summary: 'A boostergang that strips cars, and the people in them, for parts.',
    fx_goals: 'Own every salvage yard in Santo Domingo, and the roads between them.',
    fx_assets: 'Three yards, a chop shop, roadblocks on demand, and a payment net that keeps going dark.',
    fx_relations: ties([SAINTS, 'enemy'], [HALCYON, 'friendly', 'Paid through Doc Haas'], [TASKFORCE, 'enemy']),
    fx_members: people(['char_5a7754ea', 'Leader']),
    fx_secret: 'Halcyon pays them, through Doc Haas, to keep "salvage" flowing to Site 9.',
  },
  {
    id: HALCYON, known: true, category: 'corporation', name: 'Halcyon Biotics', leader: 'Celeste Ward (acquisitions)', base: 'Halcyon Biotics Tower, Night City', founded: { y: 2031, m: 4 },
    summary: 'A biotech corp with a friendly logo and a clinical trials division nobody talks about.',
    fx_goals: 'Get Patient Zero back. Keep Site 9 off every map.',
    fx_assets: 'Lawyers, private security, and a clinical facility that isn\'t on any register.',
    fx_relations: ties([SITE9, 'controls'], [VULTURES, 'friendly', 'Through Doc Haas'], [SAINTS, 'wary', 'Useful, until they aren\'t'], [TASKFORCE, 'neutral', 'Donates to the precinct\'s widows\' fund']),
    fx_members: people(['char_5b413680', 'Acquisitions executive'], ['char_08fc73a4', 'Their ripperdoc on retainer']),
    fx_secret: 'The Tin Man was a Halcyon trial subject. Site 9 made him.',
  },
  {
    id: TASKFORCE, known: true, category: 'government', name: 'NCPD Task Force Vulture', leader: 'Lt. Mara "Hammerhead" Reyes', base: 'NCPD Precinct 14', founded: { y: 2045, m: 2, d: 20 },
    summary: 'A precinct task force set up to end Vulture Season, by any means it can get away with.',
    fx_goals: 'Break the Chrome Vultures. Close the Tin Man case before the feeds do it for them.',
    fx_assets: 'Badges, warrants, and MAX-TAC on speed dial.',
    fx_relations: ties([VULTURES, 'enemy'], [SAINTS, 'rival'], [HALCYON, 'neutral']),
    fx_members: people(['char_b91339e6', 'Leads the task force']),
  },
  {
    id: SITE9, known: false, category: 'other', name: 'Site 9', leader: 'Unknown', base: 'Site 9 Clinical Facility', founded: { y: 2041, m: 11, d: 2 },
    summary: 'Halcyon\'s off-books clinical program. Its subjects don\'t leave.',
    fx_goals: 'Finish the trial. Recover every subject that walked out.',
    fx_relations: ties([HALCYON, 'part', 'Funded off the books']),
    fx_secret: 'Patient Zero and the Tin Man are both Site 9 subjects. Only one of them wants to come back.',
  },
];

for (const f of FACTIONS) {
  const { id, known, category, name, leader, base: hq, founded, summary, ...extra } = f;
  const entity = normalizeEntity({
    format: 'tempest.entity', version: 1, kind: 'factions', id,
    presetId: preset.id, presetName: preset.name,
    sheet: { kind: 'factions', fields: preset.fields, layout: preset.layout },
    values: { ...defaultValues(preset), category, name, leader, base: hq, founded, summary, ...extra },
    shown: {}, refs: {}, ...(known ? { known: true } : {}),
    createdAt: STAMP, updatedAt: STAMP,
  }, { kind: 'factions' });
  write(`factions/${id}.json`, entity);
  console.log(`faction: ${entity.name}${known ? '' : ' (GM only)'}`);
}
