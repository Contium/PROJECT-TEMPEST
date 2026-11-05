// Seeds demo content into a TEMPEST project through the running server's API, so
// every entry passes the app's own checks. Anything that already exists by name is
// skipped, so it's safe to run again.
//   node scripts/build-demo.mjs <projectId> [baseUrl]   (see the Demo project section of the README)
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROJECT, BASE = 'http://127.0.0.1:4077'] = process.argv.slice(2);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const M = await mod('app/forge/preset-model.js');
const E = await mod('app/forge/entity-model.js');
const CPR = await mod('app/forge/templates/cyberpunk-red-player.js');

const api = async (method, url, body) => {
  const res = await fetch(`${BASE}/api/projects/${PROJECT}${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
};
const made = { skipped: [], created: [] };
const ids = {}; // name → id, for links between entries

async function existing(kind) {
  const list = await api('GET', `/${kind}`);
  for (const e of list) ids[e.name ?? e.headline] = e.id;
  return new Set(list.map((e) => e.name ?? e.headline));
}

// --- presets ---------------------------------------------------------------------------

const presets = await api('GET', '/presets/characters');
let cprPreset = presets.find((p) => p.name === CPR.name);
if (!cprPreset) {
  cprPreset = await api('POST', '/presets/characters', M.normalizePreset(CPR.build()));
  made.created.push(`preset: ${cprPreset.name}`);
} else made.skipped.push(`preset: ${cprPreset.name}`);
cprPreset = await api('GET', `/presets/characters/${cprPreset.id}`);
const npcPreset = await api('GET', `/presets/characters/${presets.find((p) => p.name === 'Cyberpunk RED Character').id}`);
const storyPreset = await api('GET', `/presets/stories/${(await api('GET', '/presets/stories'))[0].id}`);
const itemPreset = await api('GET', `/presets/items/${(await api('GET', '/presets/items'))[0].id}`);

async function forge(kind, preset, values, names) {
  if (names.has(values.name)) {
    made.skipped.push(`${kind}: ${values.name}`);
    return;
  }
  const entity = E.forge(preset, { values: { ...E.defaultValues(preset), ...values } });
  const out = await api('POST', `/${kind}`, entity);
  ids[out.name] = out.id;
  names.add(out.name);
  made.created.push(`${kind}: ${out.name}`);
}

// --- player characters (Cyberpunk RED: Player Character) ---------------------------------

const n = (value) => ({ value });
const pool = (value, max = value) => ({ value, max });

/** A CPR player: STATS, derived numbers by the rules, skills by id. */
function cprValues({ stats, humanityLost, skills, ...rest }) {
  const [INT, REF, DEX, TECH, COOL, WILL, LUCK, MOVE, BODY, EMP] = stats;
  const hp = 10 + 5 * Math.ceil((BODY + WILL) / 2);
  const humanity = EMP * 10 - humanityLost;
  const v = {
    category: 'player', species: 'Human', size: 'Medium',
    cpr_int: n(INT), cpr_ref: n(REF), cpr_dex: n(DEX), cpr_tech: n(TECH), cpr_cool: n(COOL), cpr_will: n(WILL),
    cpr_luck: pool(LUCK), cpr_move: n(MOVE), cpr_body: n(BODY), cpr_emp: { value: Math.floor(humanity / 10), max: EMP },
    cpr_hp: pool(hp), cpr_seriously_wounded: n(Math.ceil(hp / 2)), cpr_death_save: n(BODY),
    cpr_humanity: { value: humanity, max: EMP * 10 },
  };
  for (const [id, level] of Object.entries(skills)) v[`cpr_sk_${id}`] = n(level);
  for (const [k, val] of Object.entries(rest)) v[k.startsWith('cpr_') || ['name', 'summary', 'image'].includes(k) ? k : `cpr_${k}`] = val;
  return v;
}

const BASIC = { athletics: 2, brawling: 2, concentration: 2, conversation: 2, education: 2, evasion: 2, first_aid: 2, human_perception: 2, language: 4, local_expert: 4, perception: 2, persuasion: 2, stealth: 2 };

const players = [
  cprValues({
    name: 'Sabine "Patchwork" Okoye',
    summary: 'Street medic of the Static Saints. Stitches you up, then lectures you about it.',
    role: { rarity: 'medtech' }, rank: n(4),
    role_ability: 'Medicine (Rank 4)\n· Surgery 2\n· Medical Pharmaceuticals 2: Speedheal, Antibiotic\nCan install cyberware and treat Critical Injuries that need Surgery.',
    stats: [7, 6, 6, 8, 5, 6, 6, 6, 5, 7], humanityLost: 8,
    skills: { ...BASIC, first_aid: 6, paramedic: 6, basic_tech: 4, cybertech: 4, human_perception: 4, conversation: 4, education: 4, science: 4, deduction: 2, handgun: 4, evasion: 4, perception: 4, resist_torture: 2 },
    weapons: 'Weapon · DMG · Ammo · ROF · Notes\nHeavy Pistol · 3d6 · 8 · 2 · Smartgun-linked\nKnife · 1d6 · — · 2 · Scalpel-sharp, for emergencies',
    armor: 'Head: Light Armorjack, SP 11\nBody: Light Armorjack, SP 11\nShield: HP —\nPenalty (applies to REF, DEX & MOVE): none',
    cw_neural: 'Neural Link\n· Interface Plugs\n· Chipware Socket: Pharmaceutical Recall chip',
    cw_eye_r: 'Cybereye\n· MicroOptics (medical scan overlay)',
    cw_internal: 'Nasal Filters',
    gear: 'Name · Notes\nMedtech Bag · Bandages, sutures, a bone saw she never names\nAirhypo · Loaded with Speedheal\nAgent · Cracked screen, reliable\nFlashlight',
    ammo: '16 rounds Heavy Pistol basic',
    cash: n(1100),
    lifestyle: 'Lifestyle: Generic Prepak\nHousing: Cargo container, The Glen\nRent: 500eb/month',
    aliases: 'Doc (she hates it), Patch',
    rep_events: 'Kept a Chrome Vulture alive on a bar table while his crew held guns on her. They still send her flowers.',
    reputation: n(2), ip: n(30),
    lp_origins: 'Sub-Saharan African; grew up speaking Igbo and Streetslang',
    lp_personality: 'Personality: Stable and serious\nClothing style: Leisurewear\nHairstyle: Short and curly\nAffectation: Wears a surgical mask around her neck at all times',
    lp_values: 'What do you value most? Honesty\nFeelings about people: Every person is a valuable individual\nMost valued person: Her younger brother, Ike, in a Corp school\nMost valued possession: Her late mentor\'s bone saw',
    lp_family: 'Family background: Corporate Technicians\nChildhood environment: In a huge megastructure controlled by a Corp\nFamily crisis: Your family lost everything through betrayal',
    lp_friends: 'Juniper "Jinx" Vale: like a younger sibling to her',
    lp_enemies: 'Who? Doc Viktor Haas, ripperdoc\nWhat caused it? She reported his organ trade to the NCPD; nothing happened\nWhat can they throw at you? Bad chrome, hired gangers\nWhat\u2019s gonna happen? She\u2019ll be the one to put him out of business',
    lp_love: 'None, yet. Too busy.',
    lp_goals: 'Open a free clinic in The Glen that no Corp can buy.',
    lp_role: 'What kind of Medtech? Street medic\nWho are your main clients? Edgerunners and the people who can\'t pay',
  }),
  cprValues({
    name: 'Dez "Overclock" Marquez',
    summary: 'Netrunner of the Static Saints. Talks fast, jacks in faster.',
    role: { rarity: 'netrunner' }, rank: n(4),
    role_ability: 'Interface (Rank 4)\n4 NET Actions per Turn\nCyberdeck: "Zero Day" (7 slots)\nPrograms: Sword, Armor, See Ya, Eraser, Worm',
    stats: [8, 7, 6, 7, 6, 5, 6, 6, 5, 6], humanityLost: 8,
    skills: { ...BASIC, electronics: 6, cryptography: 4, library_search: 4, basic_tech: 4, cybertech: 2, handgun: 4, evasion: 4, conceal_reveal: 4, stealth: 4, education: 4 },
    weapons: 'Weapon · DMG · Ammo · ROF · Notes\nMedium Pistol · 2d6 · 12 · 2 · Chrome-plated, a gift',
    armor: 'Head: Kevlar®, SP 7\nBody: Kevlar®, SP 7\nShield: HP —\nPenalty (applies to REF, DEX & MOVE): none',
    cw_neural: 'Neural Link\n· Interface Plugs\n· Chipware Socket: Memory Chip (Night City subnets)',
    cw_eye_l: 'Cybereye\n· Virtuality goggles overlay\n· Low Light/Infrared/UV',
    cw_fashion: 'Light Tattoo: a slowly scrolling line of hex down his left forearm',
    gear: 'Name · Notes\nCyberdeck "Zero Day" · Poor quality shell, excellent code\nVirtuality Goggles\nTech Bag\nAgent · Two of them; one is bait',
    ammo: '24 rounds Medium Pistol basic',
    cash: n(800),
    lifestyle: 'Lifestyle: Kibble\nHousing: Cube hotel, Little China\nRent: 500eb/month',
    aliases: 'Overclock, D-Mar, "that kid"',
    rep_events: 'Took down the Chrome Vultures\' payment server live on a stream. Twice.',
    reputation: n(1), ip: n(30),
    lp_origins: 'South/Central American; Spanish and Streetslang',
    lp_personality: 'Personality: Silly and fluff-headed (it\'s an act)\nClothing style: Urban Flash\nHairstyle: Striped\nAffectation: Never stops tapping a rhythm on something',
    lp_values: 'What do you value most? Knowledge\nFeelings about people: People are untrustworthy. Don\'t depend on anyone\nMost valued person: Mama Ndiaye, who gave him his first job\nMost valued possession: The deck "Zero Day"',
    lp_family: 'Family background: Edgerunners\nChildhood environment: Ran on The Street, with no adult supervision\nFamily crisis: Your family vanished. You are the only remaining member',
    lp_friends: 'Tomasz "Brick" Wolanski: a partner; Brick carries him out when the run goes bad',
    lp_enemies: 'Who? Rafael "Razor" Sosa\nWhat caused it? The Vulture server stunt\nWhat can they throw at you? A whole gang\nWhat\u2019s gonna happen? They\'re hunting him: avoid Santo Domingo',
    lp_love: 'A netrunner who called herself Moth. She flatlined in the Old NET\'s ruins.',
    lp_goals: 'Find out what happened to his parents\' last job.',
    lp_role: 'Are you independent or part of a team? Part of the Static Saints\nWhat kind of runner? Data thief, for a good cause (usually)',
  }),
  cprValues({
    name: 'Tomasz "Brick" Wolanski',
    summary: 'The Static Saints\' Solo. Polite, patient, and very hard to move.',
    role: { rarity: 'solo' }, rank: n(4),
    role_ability: 'Combat Awareness (Rank 4)\nUsual split: Initiative Reaction 2, Threat Detection 2\nSwitches to Precision Attack 2 when the shooting starts.',
    stats: [6, 8, 7, 4, 6, 6, 6, 7, 8, 4], humanityLost: 9,
    skills: { ...BASIC, handgun: 6, shoulder_arms: 6, autofire: 4, melee_weapon: 4, brawling: 4, evasion: 6, athletics: 4, endurance: 4, tactics: 4, perception: 4, interrogation: 2, drive_land: 2 },
    weapons: 'Weapon · DMG · Ammo · ROF · Notes\nAssault Rifle · 5d6 · 25 · 1 · Autofire (4)\nVery Heavy Pistol · 4d6 · 8 · 1 · Backup\nHeavy Melee Weapon · 3d6 · — · 2 · An old riot baton',
    armor: 'Head: Medium Armorjack, SP 12\nBody: Medium Armorjack, SP 12\nShield: HP —\nPenalty (applies to REF, DEX & MOVE): -2',
    cw_arm_r: 'Cyberarm (Standard Hand)\n· Popup Grenade Launcher\n· Subdermal Grip',
    cw_eye_r: 'Cybereye\n· Targeting Scope',
    cw_internal: 'Toxin Binders',
    cw_borg: 'none (yet)',
    gear: 'Name · Notes\nRope (60m)\nHandcuffs (x2)\nBinoculars\nAgent',
    ammo: '50 rounds Rifle basic, 16 rounds Very Heavy Pistol basic, 2 Armor-Piercing grenades',
    cash: n(500),
    lifestyle: 'Lifestyle: Generic Prepak\nHousing: The Static Saints\' safehouse, The Glen\nRent: shared',
    aliases: 'Brick',
    rep_events: 'Held the stairwell of the Kabuki market alone during the blackout.',
    reputation: n(2), ip: n(30),
    lp_origins: 'Eastern European; Polish and Streetslang',
    lp_personality: 'Personality: Stable and serious\nClothing style: Businesswear (cheap)\nHairstyle: Bald\nAffectation: Always says thank you, even mid-fight',
    lp_values: 'What do you value most? Your word\nFeelings about people: I like almost everyone\nMost valued person: Sabine, who rebuilt his arm\nMost valued possession: His old unit\'s patch',
    lp_family: 'Family background: Combat Zoners\nChildhood environment: In the heart of the Combat Zone\nFamily crisis: Your family is imprisoned, and you alone escaped',
    lp_friends: 'Dez "Overclock" Marquez: a partner and the little brother he never wanted',
    lp_enemies: 'Who? Lt. Mara "Hammerhead" Reyes, NCPD\nWhat caused it? He walked out of her task force with its evidence\nWhat can they throw at you? The NCPD\nWhat\u2019s gonna happen? She wants him back, or buried',
    lp_love: 'None he\'ll talk about.',
    lp_goals: 'Get his family out of the Rancho Coronado detention camp.',
    lp_role: 'What kind of Solo? Bodyguard turned freelancer\nWho\'s gunning for you? The NCPD, quietly',
  }),
  cprValues({
    name: 'Wren "Mile Marker" Kowal',
    summary: 'Nomad wheelwoman. If it has an engine, she has opinions about it.',
    role: { rarity: 'nomad' }, rank: n(4),
    role_ability: 'Moto (Rank 4)\nFamily vehicles: a modified Roadbike and an armored Compact Groundcar with a mounted gun.',
    stats: [6, 7, 6, 7, 6, 7, 6, 6, 6, 5], humanityLost: 4,
    skills: { ...BASIC, drive_land: 6, land_vehicle_tech: 6, basic_tech: 4, shoulder_arms: 4, handgun: 2, wilderness: 4, animal_handling: 2, trading: 4, streetwise: 4, tracking: 2, endurance: 2 },
    weapons: 'Weapon · DMG · Ammo · ROF · Notes\nShotgun · 5d6 · 4 · 1 · Slugs or shells\nHeavy Pistol · 3d6 · 8 · 2',
    armor: 'Head: Leathers, SP 4\nBody: Light Armorjack, SP 11\nShield: HP —\nPenalty (applies to REF, DEX & MOVE): none',
    cw_neural: 'Neural Link\n· Interface Plugs (vehicle link)',
    cw_leg_l: 'Cyberleg\n· Jump Booster',
    cw_external: 'Techhair: shifts colour with engine temperature',
    gear: 'Name · Notes\nRoad flares (x6)\nTech Bag\nAuto-repair kit\nTent and camping gear',
    ammo: '25 shotgun shells, 10 slugs, 16 rounds Heavy Pistol basic',
    cash: n(900),
    lifestyle: 'Lifestyle: Fresh food (the family farms)\nHousing: Her car, mostly\nRent: none',
    aliases: 'Mile Marker, Wren-on-wheels',
    rep_events: 'Drove the Static Saints out of the Kabuki blackout through three NCPD roadblocks.',
    reputation: n(1), ip: n(30),
    lp_origins: 'North American; English and Streetslang',
    lp_personality: 'Personality: Friendly and outgoing\nClothing style: Nomad Leathers\nHairstyle: Long and ratty\nAffectation: Names every vehicle she drives',
    lp_values: 'What do you value most? Family\nFeelings about people: People are wonderful!\nMost valued person: Her grandmother, who leads the pack\nMost valued possession: A paper road atlas from 2010',
    lp_family: 'Family background: Nomad Pack\nChildhood environment: In a Nomad pack with roots in transport\nFamily crisis: Your family is the inheritor of a family debt',
    lp_friends: 'Sabine "Patchwork" Okoye: a former lover, now a friend',
    lp_enemies: 'Who? Celeste Ward, Halcyon Biotics\nWhat caused it? Halcyon bought the family\'s debt\nWhat can they throw at you? Lawyers, money, mercenaries\nWhat\u2019s gonna happen? Wren is going to pay it off with Halcyon\'s own money',
    lp_love: 'Sabine. It ended well, mostly.',
    lp_goals: 'Clear the family debt and bring the pack back to the High Roads.',
    lp_role: 'What family? The Kowal-Redwater pack (Aldecaldo-affiliated)\nYour pack\'s specialty? Smuggling and long-haul transport',
  }),
];

// --- NPCs, monsters, creatures (the project's "Cyberpunk RED Character" preset) -----------

const F = { role: 'f_0f1fa419', int: 'f_c46c35bc', ref: 'f_d056c40a', dex: 'f_680ac7c5', tech: 'f_ea8d4bcc', cool: 'f_e7ae30fc', will: 'f_38973e6f', luck: 'f_dfe343d9', move: 'f_fec0ed33', body: 'f_35508685', emp: 'f_c423747b', hp: 'f_012cc8c7', humanity: 'f_bcb11b58', weapons: 'f_e269ce5c', armor: 'f_0c24089e', cyberware: 'f_4f726d8c', background: 'f_5ba6d046', secret: 'f_a8e0a725' };
function npc({ name, category = 'npc', species = 'Human', size = 'Medium', summary, stats, humanity, ...rest }) {
  const [INT, REF, DEX, TECH, COOL, WILL, LUCK, MOVE, BODY, EMP] = stats;
  const hp = 10 + 5 * Math.ceil((BODY + WILL) / 2);
  const v = { category, name, species, size, summary, [F.hp]: pool(hp), [F.humanity]: humanity ?? pool(EMP * 10) };
  for (const [k, val] of Object.entries({ int: INT, ref: REF, dex: DEX, tech: TECH, cool: COOL, will: WILL, luck: LUCK, move: MOVE, body: BODY, emp: EMP })) v[F[k]] = n(val);
  for (const [k, val] of Object.entries(rest)) v[F[k]] = val;
  return v;
}

const npcs = [
  npc({
    name: 'Mama Adaeze Ndiaye', summary: 'Fixer. Runs a noodle bar in Kabuki and half the jobs in it.',
    stats: [8, 5, 5, 5, 9, 7, 6, 4, 5, 8], humanity: { value: 74, max: 80 },
    role: 'Fixer (Operator 6). Reputation 6: "If Mama sends you, they let you in."',
    weapons: 'Very Heavy Pistol under the counter · 4d6\nThe noodle cleaver · 2d6',
    armor: 'Bulletproof apron (Light Armorjack, SP 11)',
    cyberware: 'Neural Link with Chipware Socket (Language Chips: Wolof, Mandarin, Japanese)\nCyberaudio Suite with Voice Stress Analyzer',
    background: 'Came to Night City after the 4th Corporate War with nothing but a recipe book. Feeds edgerunners on credit, and never forgets a debt, either way.',
    secret: 'She is quietly buying up the buildings around her bar. Someone in Halcyon Biotics is lending her the money.',
  }),
  npc({
    name: 'Doc Viktor Haas', summary: 'Ripperdoc in Little China. Cheap, fast, and not all of his parts are new.',
    stats: [8, 6, 7, 9, 4, 5, 3, 5, 5, 3], humanity: { value: 21, max: 30 },
    role: 'Medtech (Medicine 5), ripperdoc. Reputation 3, mostly bad.',
    weapons: 'Medical Monoblade · 2d6 (ignores half SP)\nAirhypo of tranquilizer',
    armor: 'Subdermal Armor, SP 11',
    cyberware: 'Cyberarm (x2) with Tool Hands and Scalpel Fingers\nCybereyes with MicroOptics and TeleOptics\nNeural Link with Sandevistan (he uses it to work faster)',
    background: 'Lost his licence in Berlin for "creative" surgery. In Night City nobody asks for a licence.',
    secret: 'Sells harvested cyberware and organs to the Chrome Vultures, who sell them on to Halcyon Biotics\' research wing.',
  }),
  npc({
    name: 'Celeste Ward', summary: 'Halcyon Biotics acquisitions executive. Always smiling, always recording.',
    stats: [8, 5, 5, 5, 8, 7, 7, 5, 4, 5], humanity: { value: 40, max: 50 },
    role: 'Exec (Teamwork 5). Reputation 5 in the Corporate Zone.',
    weapons: 'Medium Pistol, smart-linked · 2d6\nTwo bodyguards (Corporate Security)',
    armor: 'Corporate suit with Subdermal Armor, SP 11',
    cyberware: 'Neural Link with Chipware Socket\nCybereye with Image Enhance\nBiomonitor\nContraceptive Implant\nNanosurgeons',
    background: 'Climbed Halcyon\'s ladder by buying the debts of people who couldn\'t say no. Her latest project needs test subjects.',
    secret: 'The Halcyon "extraction" gig is a test. She hired the Static Saints so her own researcher would run straight into Doc Haas.',
  }),
  npc({
    name: 'Rafael "Razor" Sosa', summary: 'Boss of the Chrome Vultures, a boostergang in Santo Domingo.',
    stats: [5, 7, 8, 4, 6, 6, 5, 7, 8, 3], humanity: { value: 16, max: 30 },
    role: 'Boostergang boss. Reputation 4: feared in Santo Domingo.',
    weapons: 'Wolvers (x2) · 3d6\nShotgun · 5d6',
    armor: 'Medium Armorjack, SP 12',
    cyberware: 'Cyberarms with Wolvers\nCyberlegs with Talon Feet\nKerenzikov\nChrome skull plating (Bodyweight Suit cosmetics)',
    background: 'Started the Chrome Vultures to "salvage" what the war left behind. Now the salvage is people.',
    secret: 'He owes Doc Haas for the chrome, and Haas owes Halcyon. Razor doesn\'t know who he really works for.',
  }),
  npc({
    name: 'The Tin Man', category: 'monster', summary: 'A cyberpsycho stalking Watson\'s rooftops. More metal than man.',
    stats: [4, 8, 8, 3, 2, 8, 3, 8, 10, 1], humanity: { value: -6, max: 10 },
    role: 'Cyberpsycho. MAX-TAC Priority One.',
    weapons: 'Mantis Blades (x2) · 3d6\nPopup Heavy SMG · 3d6, Autofire 3',
    armor: 'Subdermal Armor and plating, SP 15',
    cyberware: 'Full Borg chassis (partial)\nMantis Blades, Popup Heavy SMG, Sandevistan, Grafted Muscle and Bone Lace, Cybereyes with Targeting Scope',
    background: 'Once a Halcyon Biotics security guard named Owen Tamsin. Halcyon\'s "Patient Zero" trial pushed him over the edge.',
    secret: 'His implants still broadcast on a Halcyon research frequency. Someone is watching through his eyes.',
  }),
  npc({
    name: 'Old Neon', category: 'creature', species: 'Mutant alligator', size: 'Large', summary: 'The sewers under Little China have a landlord, and she glows.',
    stats: [2, 6, 5, 0, 0, 8, 0, 4, 12, 0], humanity: pool(0),
    role: 'Creature. Urban legend that turned out to be true.',
    weapons: 'Bite · 4d6\nTail sweep · 2d6, knocks Prone',
    armor: 'Hide, SP 8',
    cyberware: 'A cheap tracking chip someone put in her decades ago, still blinking',
    background: 'Escaped from a biotech lab in the 2020s. Lives on the runoff from Doc Haas\'s clinic.',
    secret: 'Her glow comes from Halcyon\'s experimental bioluminescent marker: proof of where Haas dumps his waste.',
  }),
];

// --- stories ---------------------------------------------------------------------------

const S = { leads: 'f_bf5aae98', job: 'f_5614b4d0', where: 'f_01a830e7', who: 'f_69f9405f', payout: 'f_18599300', complications: 'f_1b88e90a', truth: 'f_ebdb6fa6' };
const d = (y, m, dd) => ({ y, m, d: dd });
const who = (...people) => ({ people: people.filter(([name]) => ids[name]).map(([name, note]) => ({ id: ids[name], note })) });

// --- run -------------------------------------------------------------------------------

let names = await existing('characters');
for (const v of players) await forge('characters', cprPreset, v, names);
for (const v of npcs) await forge('characters', npcPreset, v, names);

names = await existing('stories');
await existing('items');
const stories = () => [
  {
    name: 'Patient Zero', category: 'story', start: d(2045, 3, 12), end: d(2045, 3, 15),
    summary: 'The extracted researcher is carrying something Halcyon wants back, and so does the Tin Man.',
    [S.job]: 'Keep Dr. Imani Hale alive for three days until her buyer in Heywood can take her and her data.',
    [S.where]: { text: 'A safehouse somewhere in The Glen, then a meet at Heywood Docks' },
    [S.who]: who(['Celeste Ward', 'Wants Hale back, or wants to see what happens'], ['The Tin Man', 'Drawn to Hale\'s implant signal'], ['Sabine "Patchwork" Okoye', 'The only one who can keep Hale\'s implant stable']),
    [S.payout]: n(8000),
    [S.complications]: 'Hale\'s neural shunt is failing. Every hour it broadcasts louder. The Tin Man hears it.',
    [S.truth]: 'The shunt is the Patient Zero trial. Hale put it in herself to smuggle the results out, and it is killing her the way it killed Owen Tamsin.',
  },
  {
    name: 'The Halcyon Extraction', category: 'story', start: d(2045, 3, 10), end: d(2045, 3, 11),
    summary: 'A Halcyon Biotics researcher wants out. Mama Ndiaye has a crew for that.',
    [S.leads]: ids['Patient Zero'] ? { id: ids['Patient Zero'] } : undefined,
    [S.job]: 'Get Dr. Imani Hale out of Halcyon\'s Exec Zone lab during the shift change and hand her to Mama Ndiaye. No bodies: Halcyon pays the NCPD well.',
    [S.where]: { text: 'Halcyon Biotics research tower, Exec Zone; the service tunnels under it' },
    [S.who]: who(['Mama Adaeze Ndiaye', 'Fixer: set up the job'], ['Celeste Ward', 'Secretly hired the crew through a cut-out'], ['Dez "Overclock" Marquez', 'Has to open the tunnel doors from the NET']),
    [S.payout]: n(6000),
    [S.complications]: 'The tunnels come out next to Doc Haas\'s clinic. Chrome Vultures guard it at night.',
    [S.truth]: 'Ward wants Hale to escape, to see where she runs. Every step is being watched.',
  },
  {
    name: 'Vulture Season', category: 'event', start: d(2045, 3, 2), end: d(2045, 3, 9),
    summary: 'The Chrome Vultures go to war over Santo Domingo\'s salvage yards.',
    [S.job]: 'Not a job, a hazard: anyone crossing Santo Domingo this week does it under fire.',
    [S.where]: { text: 'Santo Domingo, mostly around the old salvage yards' },
    [S.who]: who(['Rafael "Razor" Sosa', 'Leading the Vultures'], ['Lt. Mara "Hammerhead" Reyes', 'NCPD task force, waiting for both sides to bleed']),
    [S.payout]: n(0),
    [S.complications]: 'Roadblocks on every main street. Vultures stripping cars, and drivers, for parts.',
    [S.truth]: 'Halcyon is paying both sides through Doc Haas, so the "salvage" keeps flowing.',
  },
  {
    name: 'The Tin Man Walks Again', category: 'rumor', start: d(2045, 3, 5),
    summary: 'Three dead in Watson, all torn open by blades. People say the Tin Man is back.',
    [S.job]: 'Rumor heard at Mama Ndiaye\'s: "MAX-TAC lost him on the Watson rooftops. He was carrying a Halcyon badge."',
    [S.where]: { text: 'Watson Development rooftops' },
    [S.who]: who(['The Tin Man', 'The rumor\'s subject']),
    [S.payout]: n(5000),
    [S.complications]: 'MAX-TAC posted a 5,000eb bounty, and every crew in the city wants it.',
    [S.truth]: 'True. The Tin Man is following a signal, and it leads to Dr. Hale.',
  },
];
// Built one at a time, so each story can link to the ones made before it.
for (let i = 0; i < stories().length; i++) await forge('stories', storyPreset, Object.fromEntries(Object.entries(stories()[i]).filter(([, x]) => x !== undefined)), names);

names = await existing('items');
const R = { rarity: 'rarity' };
const items = [
  { name: 'Halcyon MedSpray Injector', itemtype: 'Medical', rarity: { rarity: 'uncommon' }, summary: 'A pocket airhypo loaded with Halcyon\'s experimental fast-clot.', f_e4fdec85: n(500), f_205b3c2c: 'Action: heal 2d6 HP and stabilize a Mortally Wounded target.\nThree doses. Side effect: 1 Humanity per dose (it whispers).', f_ef26d02e: 'Matte white, a Halcyon logo laser-etched under the trigger. Stolen from the extraction.' },
  { name: '"Zero Day" Cyberdeck', itemtype: 'Cyberdeck', rarity: { rarity: 'rare' }, summary: 'Overclock\'s deck: a cheap shell around excellent code.', f_e4fdec85: n(1000), f_205b3c2c: '7 program slots. +1 to Backdoor checks against Halcyon architectures (he has their source).', f_ef26d02e: 'Wrapped in stickers from bands that broke up before Dez was born.' },
  { name: 'Vulture-Wing Monoblade', itemtype: 'Melee Weapon', rarity: { rarity: 'rare' }, summary: 'A Chrome Vulture lieutenant\'s sword, folded from car steel.', f_e4fdec85: n(1000), f_205b3c2c: 'Heavy Melee Weapon · 3d6 · ROF 2. Ignores half of the target\'s armor SP.', f_ef26d02e: 'Carrying it in Santo Domingo is a declaration of war.' },
  { name: 'Ghost-Weave Trench Coat', itemtype: 'Armor', rarity: { rarity: 'uncommon' }, summary: 'Armored coat with a thermal-masking lining.', f_e4fdec85: n(500), f_205b3c2c: 'Body SP 11, no penalty. +2 Stealth against thermographic sensors.', f_ef26d02e: 'Charcoal grey. Smells faintly of noodle broth (it\'s from Mama\'s lost and found).' },
  { name: 'Thunderclap Grenade', itemtype: 'Explosive', rarity: { rarity: 'common' }, summary: 'A flashbang that rattles the teeth.', f_e4fdec85: n(100), f_205b3c2c: 'Area 10m: DV 15 Resist Torture/Drugs or Deafened and Blinded for 1 minute.', f_ef26d02e: 'NCPD surplus. Brick keeps two.' },
  { name: 'Patient Zero Neural Shunt', itemtype: 'Cyberware (prototype)', rarity: { rarity: 'legendary' }, summary: 'The prototype at the heart of the Halcyon trial.', f_e4fdec85: n(50000), f_205b3c2c: 'Neural Link option. +2 REF, +2 INT while active.\nEach day: lose 2d6 Humanity. Broadcasts on a Halcyon research band.', f_ef26d02e: 'The size of a thumbnail. Every corp in the city would kill for it, and has.' },
];
for (const v of items) await forge('items', itemPreset, v, names);

// --- places ----------------------------------------------------------------------------

const globe = await api('GET', '/pois');
const globeNames = new Set(globe.map((p) => p.name));
const globePois = [
  { name: 'Halcyon Biotics Headquarters', type: 'landmark', lat: 47.37, lon: 8.54, revealed: true, description: 'Zurich, Switzerland. Halcyon\'s glass ziggurat on the lake. Its research money flows to Night City.' },
  { name: 'Kowal-Redwater Pack Camp', type: 'poi', lat: 35.05, lon: -117.6, revealed: true, description: 'Mojave, California. Wren\'s family camp, a day\'s drive from Night City.' },
  { name: 'Kowloon Arcology', type: 'city', lat: 22.32, lon: 114.17, revealed: true, description: 'Hong Kong. Where Doc Haas buys parts nobody else will sell.' },
  { name: 'Site 9 Clinical Facility', type: 'unknown', lat: 37.25, lon: -115.8, revealed: false, description: 'GM only. Halcyon\'s desert test site in Nevada, where Patient Zero began.' },
];
for (const p of globePois) {
  if (globeNames.has(p.name)) { made.skipped.push(`globe: ${p.name}`); continue; }
  await api('POST', '/pois', { ...p, maps: [] });
  made.created.push(`globe: ${p.name}`);
}

const city = await api('GET', '/citypois?city=nightcity');
const cityNames = new Set(city.map((p) => p.name));
const ref = (name, note = '') => (ids[name] ? [{ id: ids[name], note }] : []);
const cityPois = [
  { name: 'Mama Ndiaye\'s Noodle Bar', icon: 'contact', district: 'kabuki', x: 0.5135, y: 0.3215, description: 'Six stools, one pot, and the best job board in Kabuki.', refs: ref('Mama Adaeze Ndiaye', 'Owner') },
  { name: 'Haas Clinic', icon: 'clinic', district: 'little-china', x: 0.6035, y: 0.4805, description: 'A ripperdoc behind a laundromat. Ring twice.', refs: [...ref('Doc Viktor Haas', 'Ripperdoc'), ...ref('Old Neon', 'Lives in the sewer under the clinic')] },
  { name: 'Static Saints Safehouse', icon: 'safehouse', district: 'the-glen', x: 0.4395, y: 0.5355, description: 'A converted parking garage. The crew\'s home base.', refs: [...ref('Tomasz "Brick" Wolanski', 'Lives here'), ...ref('Sabine "Patchwork" Okoye', 'Runs a clinic on level 2')] },
  { name: 'Chrome Vultures Salvage Yard', icon: 'gang', district: 'santo-domingo', x: 0.6625, y: 0.6455, description: 'Fenced with car doors. Do not enter without an invitation.', refs: [...ref('Rafael "Razor" Sosa', 'Holds court here'), ...ref('Vulture Season', 'Center of the fighting')] },
  { name: 'Halcyon Biotics Tower', icon: 'corp', district: 'exec-zone', x: 0.7335, y: 0.3985, description: 'Forty floors of white glass and armed reception staff.', refs: [...ref('Celeste Ward', 'Office on the 31st floor'), ...ref('The Halcyon Extraction', 'Target')] },
  { name: 'NCPD Precinct 14', icon: 'police', district: 'north-heywood', x: 0.7545, y: 0.5625, description: 'Lt. Reyes\'s task force works out of the basement.', refs: ref('Lt. Mara "Hammerhead" Reyes', 'Task force lead') },
  { name: 'Watson Rooftops', icon: 'danger', district: 'watson-development', x: 0.4415, y: 0.2735, description: 'Where the Tin Man was last seen. MAX-TAC drones circle at night.', refs: [...ref('The Tin Man', 'Last sighting'), ...ref('The Tin Man Walks Again', 'The rumor')], revealed: false },
  { name: 'Kabuki Night Market', icon: 'shop', district: 'kabuki', x: 0.5075, y: 0.3295, description: 'Stalls under tarps and neon. Anything is for sale, briefly.', refs: [] },
];
for (const p of cityPois) {
  if (cityNames.has(p.name)) { made.skipped.push(`city: ${p.name}`); continue; }
  await api('POST', '/citypois', { city: 'nightcity', revealed: true, maps: [], ...p });
  made.created.push(`city: ${p.name}`);
}

// --- screamsheets -----------------------------------------------------------------------

const sheets = await api('GET', '/screamsheets');
const heads = new Set(sheets.map((s) => s.headline));
const screamsheets = [
  {
    headline: 'BLADES IN WATSON: IS THE TIN MAN BACK?', outlet: 'Night City Today', byline: 'Wakako Okada', dateline: 'Night City, March 6, 2045', layout: 'broadsheet', revealed: true,
    body: 'Three residents of Watson Development were found dead on the rooftops of Block 12 this morning, the third such discovery this month.\n\nWitnesses describe a tall figure "more metal than man" moving between buildings faster than the eye could follow. MAX-TAC declined to comment, but sources inside the NCPD confirm a 5,000eb bounty has been posted.\n\nHalcyon Biotics, whose former employee was linked to similar killings last year, issued a statement calling the reports "irresponsible speculation."',
    mentions: [ids['The Tin Man'], ids['Wakako Okada']],
  },
  {
    headline: '//FEED: VULTURE PAYMENT NET GOES DARK, AGAIN', outlet: 'Screamsheet 54 // Street Feed', byline: 'anon', dateline: '03.04.45 // 02:17', layout: 'crt', revealed: true,
    body: 'The Chrome Vultures\' payment server went down for the second time this week. A message looped on every Vulture agent in Santo Domingo for eleven minutes: "THE SAINTS SAY HI."\n\nRazor Sosa has put a price on the runner responsible. Street says the price is higher than the server was worth.',
    mentions: [ids['Rafael "Razor" Sosa'], ids['Dez "Overclock" Marquez']],
  },
];
for (const s of screamsheets) {
  if (heads.has(s.headline)) { made.skipped.push(`screamsheet: ${s.headline}`); continue; }
  await api('POST', '/screamsheets', { ...s, edited: true, selection: null, values: {}, mentions: s.mentions.filter(Boolean) });
  made.created.push(`screamsheet: ${s.headline}`);
}

console.log(JSON.stringify(made, null, 2));
