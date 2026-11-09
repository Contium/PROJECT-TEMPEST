// Fills the gaps in the shipped demo campaign (demo/projects/proj_91c43227) and shows off
// per-entry visibility: each change goes through the app's own models, so every file stays
// exactly as TEMPEST would save it. Safe to run again: it sets values, it doesn't append.
//
//   - the crew's sheets: cyberaudio, neural links, injuries, addictions and notes
//   - Wakako Okada, the Night City Today reporter: description, notes, and who funds her
//   - "Leads to" links between the stories, in two arcs (March and November)
//   - what players can't see yet: the Tin Man's stats in static, his secret encrypted,
//     Hammerhead's secret hidden, Celeste Ward's encrypted, an anonymous screamsheet
//   - the players' Codex: the Tin Man and Hammerhead join it (its Monsters tab)
//   - the stray "Test" point on the City Map goes
//
//   node scripts/build-demo-polish.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEntity } from '../app/forge/entity-model.js';
import { normalizeScreamsheet } from '../app/screamsheets/screamsheet-model.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'demo', 'projects', 'proj_91c43227');
const fileOf = (kind, id) => path.join(PROJECT, kind, `${id}.json`);
const read = (kind, id) => JSON.parse(fs.readFileSync(fileOf(kind, id), 'utf8'));
const write = (kind, data) => fs.writeFileSync(fileOf(kind, data.id), `${JSON.stringify(data, null, 2)}\n`);

/** Change one entry: values to set, field visibilities ({ fieldId: 'hidden' | ['rumored', style, text?] }), known. */
function entry(kind, id, { values = {}, vis = {}, known } = {}) {
  const e = read(kind, id);
  const sheet = structuredClone(e.sheet);
  for (const [fid, v] of Object.entries(vis)) {
    const f = sheet.fields[fid];
    if (!f) throw new Error(`${e.name} has no field ${fid}`);
    const [visibility, style, text] = Array.isArray(v) ? v : [v];
    f.visibility = visibility;
    if (style) f.rumor = { style, text: text ?? '' };
  }
  const next = normalizeEntity({ ...e, sheet, values: { ...e.values, ...values }, ...(known === undefined ? {} : { known }) }, { kind });
  write(kind, next);
  console.log(`${kind}: ${next.name}`);
  return next;
}

// --- the crew ---------------------------------------------------------------------------------

entry('characters', 'char_c2806906', { // Brick, Solo
  values: {
    cpr_cw_audio: 'Cyberaudio Suite\n· Amplified Hearing\n· Radio Link (crew channel)',
    cpr_cw_neural: 'Neural Link\n· Sandevistan Speedware',
    cpr_critical_injuries: 'Old: Broken Ribs. Healed crooked; they ache before rain.',
    cpr_addictions: 'None',
    cpr_notes: 'Owes Mama Ndiaye one favour, no questions asked. Keeps a photo of the Rancho Coronado gate in his jacket.',
  },
});
entry('characters', 'char_3de62be7', { // Overclock, Netrunner
  values: {
    cpr_cw_audio: 'Cyberaudio Suite\n· Radio Scanner/Music Player',
    cpr_critical_injuries: 'None',
    cpr_addictions: 'Synthcoke. Two weeks clean and counting out loud.',
    cpr_notes: 'Ran into a Hellhound in the Steeltooth Bar and still flinches at dogs. Wants the "Hush" prototype deck more than he lets on.',
  },
});
entry('characters', 'char_52757f33', { // Mile Marker, Nomad
  values: {
    cpr_cw_audio: 'Cyberaudio Suite\n· Radio Link (convoy band)',
    cpr_cw_eye_r: 'Cybereye\n· Low Light/Infrared/UV\n· TeleOptics',
    cpr_critical_injuries: 'None',
    cpr_addictions: 'None, unless you count speed.',
    cpr_notes: 'The Kowal-Redwater pack still expects her back for the spring run. The crew\'s van is registered to a man who died in 2031.',
  },
});
entry('characters', 'char_ce151765', { // Patchwork, Medtech
  values: {
    cpr_cw_audio: 'Cyberaudio Suite\n· Voice Stress Analyzer',
    cpr_cw_arm_l: 'Cyberarm (Standard Hand)\n· Medscanner',
    cpr_critical_injuries: 'None',
    cpr_addictions: 'Caffeine, heroically.',
    cpr_notes: 'Trained under Doc Haas and left on bad terms. Recognised the stitching on the Watson bodies: surgical, not street.',
  },
});

// --- Wakako Okada, the reporter (byline of "Blades in Watson") -------------------------------

entry('characters', 'char_d1853482', {
  values: {
    summary: 'Night City Today\'s Watson stringer. Writes the stories the corps pay to bury, under her own name.',
    f_b26f7553: 'Meets sources at Mama Ndiaye\'s noodle bar, back booth, never twice in a row. Has three dead witnesses\' statements on the Tin Man that NCPD never asked for.',
    f_453991ea: { id: 'char_a14f1dad' }, // her feed's money: Marcus "Ledger" Okonkwo
  },
  vis: { f_453991ea: ['rumored', 'encrypted'] },
});

// --- the stories, as two arcs -------------------------------------------------------------------

const LEADS = 'f_bf5aae98';
entry('stories', 'story_18ca8c65', { values: { [LEADS]: { id: 'story_8b6c2aaa' } } }); // Vulture Season → The Tin Man Walks Again
entry('stories', 'story_8b6c2aaa', { // The Tin Man Walks Again → The Halcyon Extraction
  values: { [LEADS]: { id: 'story_c18274f7' } },
  vis: { f_ebdb6fa6: ['rumored', 'encrypted'] },
});
entry('stories', 'story_0ea5e98f', { values: { [LEADS]: { id: 'story_48d99f92' } } }); // Patient Zero → Ghosts in the Freight Yard
entry('stories', 'story_a6fe0f1c', { values: { [LEADS]: { id: 'story_dfc2b605' } } }); // Kabuki Night Market Blackout → Cold Storage

// --- what players don't get to see (yet) --------------------------------------------------------

const STATS = ['f_c46c35bc', 'f_d056c40a', 'f_680ac7c5', 'f_ea8d4bcc', 'f_e7ae30fc', 'f_38973e6f', 'f_dfe343d9', 'f_fec0ed33', 'f_35508685', 'f_c423747b'];
entry('characters', 'char_d692932b', { // The Tin Man: known by rumor, never measured
  known: true,
  vis: {
    ...Object.fromEntries(STATS.map((id) => [id, ['rumored', 'static']])),
    f_012cc8c7: ['rumored', 'text', 'Three people have tried to find out.'],
    f_bcb11b58: 'hidden',
    f_0c24089e: ['rumored', 'text', 'More metal than man.'],
    f_4f726d8c: ['rumored', 'redacted'],
    f_a8e0a725: ['rumored', 'encrypted'],
  },
});
entry('characters', 'char_b91339e6', { known: true, vis: { f_a8e0a725: 'hidden', f_bcb11b58: 'hidden' } }); // Hammerhead: Brick's enemy
entry('characters', 'char_5b413680', { vis: { f_a8e0a725: ['rumored', 'encrypted'] } }); // Celeste Ward

// An anonymous leak: nobody signs it, and its date line is scrambled.
{
  const s = JSON.parse(fs.readFileSync(path.join(PROJECT, 'screamsheets', 'ss_d4dfb2d3.json'), 'utf8'));
  const next = normalizeScreamsheet({ ...s, parts: { byline: { visibility: 'hidden' }, dateline: { visibility: 'rumored', style: 'encrypted' } } });
  fs.writeFileSync(path.join(PROJECT, 'screamsheets', 'ss_d4dfb2d3.json'), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`screamsheet: ${next.headline}`);
}

// A full page of Night City Today, like the rulebook's news feed: the Tin Man story leads, with
// more of the week's news, Link lines to what the crew knows, a disclaimer and an ad.
{
  const file = path.join(PROJECT, 'screamsheets', 'ss_fb3fc835.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = normalizeScreamsheet({
    ...s,
    layout: 'feed', section: 'local', dateline: '8:14 PM',
    links: [{ text: 'The Tin Man Walks Again', ref: 'story_8b6c2aaa' }, { text: 'NCPD Precinct 14' }],
    items: [
      {
        id: 'it_5ee301', type: 'article', headline: 'Kabuki Grid Back Up, Mostly', byline: 'Lin \'Lights Out\' Varga',
        body: 'Power returned to most of Kabuki at 23:00 after a ninety-minute blackout that turned the night market into a free-for-all. City engineers blame "a cascading substation fault." Stall owners blame everyone else.\n\nThree vendors report their stock walked off in the dark. One reports it walked back, minus the good stuff.',
        links: [{ text: 'Kabuki Night Market Blackout', ref: 'story_a6fe0f1c' }],
      },
      {
        id: 'it_5ee302', type: 'article', headline: 'Vultures: "We Just Fix Cars"', byline: 'Wakako Okada',
        body: 'Asked about the roadblocks springing up across Santo Domingo, a Chrome Vultures spokesman insisted the gang is "a community salvage cooperative" and that any missing vehicles "were abandoned, probably." NCPD declined to comment.',
        links: [{ text: 'Chrome Vultures Salvage Yard' }],
      },
      {
        id: 'it_5ee303', type: 'ad',
        image: 'img_02d856aeca8e5d83ae7ad128',
        tagline: 'Arc-9 Heavy Pistol · Loud, cheap, yours.\nNo questions at the counter.',
        links: [{ text: 'Arc-9 Heavy Pistol', ref: 'item_cf0f2ab4' }],
      },
      {
        id: 'it_5ee304', type: 'article', headline: 'Best Noodles in Kabuki (Bring a Friend)', byline: 'Dash Okafor',
        body: 'Mama Ndiaye\'s back booth has been serving the same broth since before the war, and the fixers who eat there swear it\'s the only safe table in the district. The noodles are perfect. The conversations at the next table are none of your business.',
        links: [{ text: 'Mama Ndiaye\'s Noodle Bar' }],
      },
      {
        id: 'it_5ee305', type: 'article', headline: 'Health Warning', byline: 'Night City Health Department',
        body: 'A friendly reminder from the Night City Health Department: the Watson rooftops are closed until further notice. Residents are asked to stay off them after dark.',
        notes: [{ label: 'Disclaimer', text: 'The Health Department does not comment on rumors, cyberpsychosis or the Tin Man, and is not responsible for anything you meet up there.' }],
      },
    ],
  });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`screamsheet: ${next.headline} (${next.items.length + 1} pieces)`);
}

// --- tidy up ------------------------------------------------------------------------------------

const stray = path.join(PROJECT, 'citypois', 'cpoi_a9bd0b33.json');
if (fs.existsSync(stray) && JSON.parse(fs.readFileSync(stray, 'utf8')).name === 'Test') {
  fs.rmSync(stray);
  console.log('removed the "Test" City Map point');
}
