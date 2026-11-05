// Marks what the demo crew already knows of (entity.known), so the demo's player Codex
// opens with the Static Saints themselves, the people they've met, the jobs and rumors
// going round and the gear they've seen. Revealed screamsheets and places join on their own.
//
//   node scripts/build-codex-demo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEntity } from '../app/forge/entity-model.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'demo', 'projects', 'proj_91c43227');

const KNOWN = {
  characters: [
    'char_c2806906', 'char_3a87e3ae', 'char_3de62be7', 'char_52757f33', 'char_ce151765', // the crew
    'char_08fc73a4', 'char_652e9dae', 'char_5a7754ea', 'char_5b413680', // Doc Haas, Mama Ndiaye, Razor, Celeste Ward
    'char_65cc6cbc', // Rusty, the junkyard cyberhound
  ],
  stories: ['story_18ca8c65', 'story_a6fe0f1c', 'story_48d99f92', 'story_8b6c2aaa', 'story_c18274f7'],
  items: ['item_3114120d', 'item_cf0f2ab4', 'item_b694a970', 'item_d44186f4', 'item_d9d52f26'],
};

for (const [kind, ids] of Object.entries(KNOWN)) {
  for (const id of ids) {
    const file = path.join(PROJECT, kind, `${id}.json`);
    const entity = JSON.parse(fs.readFileSync(file, 'utf8'));
    const next = normalizeEntity({ ...entity, known: true }, { kind });
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`known: ${next.name}`);
  }
}
