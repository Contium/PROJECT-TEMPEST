// Builds the demo campaign's Initiative Tracker encounter
// (demo/projects/proj_91c43227/encounter.json): the Static Saints, initiative already
// rolled, against the Tin Man, his junkyard cyberhound and two scavengers. Combat isn't
// started, so the demo opens on a ready fight: press Start combat and the turn order
// appears on the player screens.
//
//   node scripts/build-initiative-demo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../app/combat/initiative-model.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'demo', 'projects', 'proj_91c43227');
const character = (id) => JSON.parse(fs.readFileSync(path.join(PROJECT, 'characters', `${id}.json`), 'utf8'));

// The crew, with the initiative each player rolled (1d10 + REF).
const CREW = [
  ['char_c2806906', 15], // Tomasz "Brick" Wolanski, Solo
  ['char_3a87e3ae', 14], // Juniper "Jinx" Vale
  ['char_3de62be7', 12], // Dez "Overclock" Marquez, Netrunner
  ['char_52757f33', 11], // Wren "Mile Marker" Kowal, Nomad
  ['char_ce151765', 9], // Sabine "Patchwork" Okoye, Medtech
];
// Fixed rolls, so the file is the same every build.
const rolls = [0.65, 0.35, 0.85, 0.15];
let r = 0;
const rng = () => rolls[r++ % rolls.length];

let s = M.empty({ die: 'd10' });
let ids = 0;
const stable = (state) => ({ ...state, combatants: state.combatants.map((c) => (/^c_5ee2/.test(c.id) ? c : { ...c, id: `c_5ee2${String(++ids).padStart(4, '0')}` })) });
for (const [id, init] of CREW) s = stable(M.act(s, { action: 'add', entityId: id, init }, { source: M.sourceFrom(character(id)) }));
s = stable(M.act(s, { action: 'add', entityId: 'char_d692932b' }, { source: M.sourceFrom(character('char_d692932b')) })); // The Tin Man
s = stable(M.act(s, { action: 'add', entityId: 'char_65cc6cbc', side: 'enemy' }, { source: M.sourceFrom(character('char_65cc6cbc')) })); // Rusty
s = stable(M.act(s, { action: 'add', name: 'Junkyard Scav', hp: 25, armor: 7, initBonus: 5, count: 2 }));
s = stable(M.act(s, { action: 'roll' }, { rng }));
// Rusty sticks to the Tin Man's heel; one scav hangs back in the scrap, unseen.
const scav = s.combatants.find((c) => c.name === 'Junkyard Scav' && c.no === 2);
s = M.act(s, { action: 'update', id: scav.id, patch: { hidden: true } });
s = M.act(s, { action: 'update', id: s.combatants.find((c) => c.entityId === 'char_ce151765').id, patch: { slotsText: 'Airhypo 2, Med Kit 3' } });
s = M.act(s, { action: 'update', id: s.combatants.find((c) => c.entityId === 'char_3de62be7').id, patch: { slotsText: 'Cyberdeck slots 7' } });
const out = { ...s, rev: 0 };
fs.writeFileSync(path.join(PROJECT, 'encounter.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(out.combatants.map((c) => `${String(c.init).padStart(3)}  ${M.nameOf(c)}  ${c.hp}/${c.maxHp}${c.armor != null ? `  SP ${c.armor}` : ''}${c.hidden ? '  (hidden)' : ''}`).join('\n'));
