// Builds the demo campaign's Netrunning part: the three Cyberpunk RED net card
// presets, a deck of ready-made net cards, and the Steeltooth Bar network, written
// straight into demo/projects/<id>/ (presets/netcards/, netcards/, networks/).
//
//   node scripts/build-netrun-demo.mjs [projectId]
//
// Every id is fixed, so running it again rewrites the same files. Installed demos pick
// up files they never had on the next start (server/demo.js).
//
// The stat lines follow the Cyberpunk RED Core Rulebook's Black ICE and Demon tables
// (R. Talsorian Games); the effects are short summaries in our own words. Check them
// against your book before play.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePreset } from '../app/forge/preset-model.js';
import { forge, normalizeEntity } from '../app/forge/entity-model.js';
import { normalizeNetwork } from '../app/netrun/network-model.js';
import { blackIce, demon, node } from '../app/forge/templates/cyberpunk-red-net.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectId = process.argv[2] ?? 'proj_91c43227';
const dir = path.join(ROOT, 'demo', 'projects', projectId);
if (!fs.existsSync(path.join(dir, 'project.json'))) throw new Error(`No demo project ${projectId}`);
const AT = '2026-11-04T23:00:00.000Z';

const write = (rel, data) => {
  const file = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

// --- presets -------------------------------------------------------------------------------------

const presets = {};
for (const [key, template, id] of [['ice', blackIce, 'preset-cpr-black-ice'], ['demon', demon, 'preset-cpr-demon'], ['node', node, 'preset-cpr-net-node']]) {
  const p = normalizePreset({ ...template.build(), id, createdAt: AT, updatedAt: AT });
  presets[key] = p;
  write(`presets/netcards/${id}.json`, p);
}

// --- cards ----------------------------------------------------------------------------------------

function card(id, presetKey, values) {
  const made = forge(presets[presetKey], { values });
  const entity = normalizeEntity({ ...made, id, createdAt: AT, updatedAt: AT }, { kind: 'netcards' });
  write(`netcards/${id}.json`, entity);
  return entity;
}

const ice = (id, name, cls, [per, spd, atk, def, rez], summary, effect) =>
  card(id, 'ice', { category: 'ice', name, summary, ice_class: { rarity: cls }, ice_stats: { per: String(per), spd: String(spd), atk: String(atk), def: String(def), rez: String(rez) }, effect });

const C = {
  password: card('ncard_5ee10001', 'node', {
    category: 'password', name: 'Password', dv: '6',
    summary: 'A lock between floors. Nobody goes deeper until it\'s cracked.',
    effect: 'Beaten with Backdoor. Until then, the Netrunner can\'t move past this floor.',
    contents: '', controls: '',
  }),
  file: card('ncard_5ee10002', 'node', {
    category: 'file', name: 'File', dv: '8',
    summary: 'Stored data, read with Eye-Dee.',
    effect: 'Beaten with Eye-Dee: the Netrunner learns what\'s in it and can copy or erase it.',
    contents: 'Whatever the run is after: set it per network in the node\'s GM note.',
    controls: '',
  }),
  control: card('ncard_5ee10003', 'node', {
    category: 'control', name: 'Control Node', dv: '8',
    summary: 'Runs something in meatspace: cameras, doors, turrets, alarms.',
    effect: 'Beaten with Control: the Netrunner works whatever it runs until they jack out.',
    contents: '',
    controls: 'Named per network in the node\'s label, e.g. Control Node (Cameras).',
  }),
  skunk: ice('ncard_5ee10011', 'Skunk', 'anti_personnel', [2, 4, 4, 2, 10],
    'Cheap and nasty: it makes it hard to slip away.',
    'Until it\'s derezzed, the Netrunner it hit is worse at Sliding away from Black ICE.'),
  liche: ice('ncard_5ee10012', 'Liche', 'anti_personnel', [8, 2, 6, 2, 25],
    'Scrambles the mind behind the deck.',
    'A hit leaves the Netrunner\'s INT, REF and DEX lowered for about an hour.'),
  raven: ice('ncard_5ee10013', 'Raven', 'anti_personnel', [6, 4, 4, 2, 15],
    'Goes for the defenses first, then the brain.',
    'A hit derezzes one of the Netrunner\'s Defender programs, then deals brain damage.'),
  hellhound: ice('ncard_5ee10014', 'Hellhound', 'anti_personnel', [6, 6, 6, 2, 20],
    'Fire in the NET, fire in the meat.',
    'A hit deals brain damage and sets the Netrunner\'s body alight in meatspace until someone puts them out.'),
  wisp: ice('ncard_5ee10015', 'Wisp', 'anti_personnel', [4, 4, 4, 2, 15],
    'A flicker that leaves the Netrunner sluggish.',
    'A hit deals brain damage and costs the Netrunner a NET Action on their next turn.'),
  sabertooth: ice('ncard_5ee10016', 'Sabertooth', 'anti_program', [8, 6, 6, 2, 25],
    'Program-killer.',
    'Hunts the Netrunner\'s programs: a hit destroys one of them outright.'),
  imp: card('ncard_5ee10021', 'demon', {
    category: 'demon', name: 'Imp', summary: 'A small Demon that keeps a small architecture running.',
    demon_stats: { rez: '15', interface: '3', net_actions: '2', combat: '14' },
    effect: 'Runs the architecture\'s Black ICE and defends its floors; it acts on its own NET Actions.',
  }),
};

// --- the Steeltooth Bar ----------------------------------------------------------------------------

const net = normalizeNetwork({
  id: 'net_5ee17007',
  name: 'Steeltooth Bar',
  description: 'The private network behind a Tyger Claws bar in Watson: the cameras, the alarm and the back-room ledger. Overclock can jack in from the booth by the toilets.',
  nodes: [
    { id: 'n5ee101', card: C.password.id, dv: '6', parents: [] },
    { id: 'n5ee102', card: C.skunk.id, parents: ['n5ee101'] },
    { id: 'n5ee103', card: C.control.id, label: 'Control Node (Cameras)', dv: '8', parents: ['n5ee102'], note: 'Every camera in the bar and the alley out back. Loop the feed and the crew walks in unseen.' },
    { id: 'n5ee104', card: C.password.id, dv: '8', parents: ['n5ee103'] },
    { id: 'n5ee105', card: C.liche.id, label: 'Liche, Raven', parents: ['n5ee103'], note: 'Two Black ICE on one floor: the Liche and a Raven activate together.' },
    { id: 'n5ee106', card: C.file.id, dv: '8', parents: ['n5ee104'], note: 'The back-room ledger: who owes the bar, and which Tyger Claws collect. Leverage on the owner.' },
    { id: 'n5ee107', card: C.control.id, label: 'Control Node (Alarm)', dv: '8', parents: ['n5ee105'], note: 'Trips the alarm, or keeps it quiet. Tripped, four bouncers come running.' },
    { id: 'n5ee108', card: C.hellhound.id, count: 2, parents: ['n5ee106', 'n5ee107'], note: 'Guards the bottom floor whichever way the Netrunner comes down.' },
  ],
  revealed: [],
  hints: false,
  createdAt: AT,
  updatedAt: AT,
});
write(`networks/${net.id}.json`, net);

console.log(`Wrote ${Object.keys(presets).length} presets, ${Object.keys(C).length} net cards and the "${net.name}" network into ${path.relative(ROOT, dir)}`);
