// Cyberpunk RED player character: a ready-made character preset that follows the
// official character sheet (RTG-CPR-CharacterSheet.pdf) and the Easy Mode rules,
// both by R. Talsorian Games. It uses only TEMPEST's ordinary field types, so once
// it's opened in the designer it is a preset like any other, free to change.
//
// The sheet's pages become sections, in its order: Role, STATS, health, the nine
// skill groups, weapons and armor, cyberware (a body diagram, like the sheet's
// skeleton page), gear, reputation, lifepath, notes.
// Numbers that the rules derive from others (Hit Points, Seriously Wounded, Death
// Save, Humanity) are plain fields that the GM fills in; their defaults match a
// character with every STAT at 5 (see the formulas in build() below).

import { PRESET_FORMAT, PRESET_VERSION } from '../preset-model.js';

export const id = 'cyberpunk-red-player';
export const kind = 'characters';
export const name = 'Cyberpunk RED: Player Character';
export const description = 'The official Cyberpunk RED character sheet: STATS, Hit Points and Humanity, all 66 Skills, Role and Role Ability, weapons, armor, cyberware, gear, reputation and the full Lifepath.';

// The ten Roles (Core Rulebook), each with its Role Ability, as a pick list.
const ROLES = [
  ['rockerboy', 'Rockerboy (Charismatic Impact)', '#e0569a', 'glow'],
  ['solo', 'Solo (Combat Awareness)', '#ff4d4d', 'glow'],
  ['netrunner', 'Netrunner (Interface)', '#22c3d6', 'glow'],
  ['tech', 'Tech (Maker)', '#f5b041', 'outline'],
  ['medtech', 'Medtech (Medicine)', '#3fbf7f', 'outline'],
  ['media', 'Media (Credibility)', '#4f8cff', 'outline'],
  ['exec', 'Exec (Teamwork)', '#c8ccd2', 'outline'],
  ['lawman', 'Lawman (Backup)', '#5b7cfa', 'outline'],
  ['fixer', 'Fixer (Operator)', '#a259ff', 'outline'],
  ['nomad', 'Nomad (Moto)', '#c27c4e', 'outline'],
].map(([rid, rname, color, style]) => ({ id: rid, name: rname, color, style }));

// The STATS, in the sheet's order. LUCK and EMP are spent or lost in play, so
// they're pools ("out of" on the sheet); the rest are single numbers.
const STATS = [
  ['int', 'INT (Intelligence)'],
  ['ref', 'REF (Reflexes)'],
  ['dex', 'DEX (Dexterity)'],
  ['tech', 'TECH (Technique)'],
  ['cool', 'COOL'],
  ['will', 'WILL (Willpower)'],
  ['luck', 'LUCK', 'pool'],
  ['move', 'MOVE (Movement)'],
  ['body', 'BODY'],
  ['emp', 'EMP (Empathy)', 'pool'],
];

// Every Skill on the sheet, by group, with its STAT. "x2" Skills cost double to raise.
const SKILLS = [
  ['Awareness Skills', [
    ['concentration', 'Concentration', 'WILL'],
    ['conceal_reveal', 'Conceal/Reveal Object', 'INT'],
    ['lip_reading', 'Lip Reading', 'INT'],
    ['perception', 'Perception', 'INT'],
    ['tracking', 'Tracking', 'INT'],
  ]],
  ['Body Skills', [
    ['athletics', 'Athletics', 'DEX'],
    ['contortionist', 'Contortionist', 'DEX'],
    ['dance', 'Dance', 'DEX'],
    ['endurance', 'Endurance', 'WILL'],
    ['resist_torture', 'Resist Torture/Drugs', 'WILL'],
    ['stealth', 'Stealth', 'DEX'],
  ]],
  ['Control Skills', [
    ['drive_land', 'Drive Land Vehicle', 'REF'],
    ['pilot_air', 'Pilot Air Vehicle', 'REF', 2],
    ['pilot_sea', 'Pilot Sea Vehicle', 'REF'],
    ['riding', 'Riding', 'REF'],
  ]],
  ['Education Skills', [
    ['accounting', 'Accounting', 'INT'],
    ['animal_handling', 'Animal Handling', 'INT'],
    ['bureaucracy', 'Bureaucracy', 'INT'],
    ['business', 'Business', 'INT'],
    ['composition', 'Composition', 'INT'],
    ['criminology', 'Criminology', 'INT'],
    ['cryptography', 'Cryptography', 'INT'],
    ['deduction', 'Deduction', 'INT'],
    ['education', 'Education', 'INT'],
    ['gamble', 'Gamble', 'INT'],
    ['language', 'Language: Streetslang', 'INT'],
    ['library_search', 'Library Search', 'INT'],
    ['local_expert', 'Local Expert: Your Home', 'INT'],
    ['science', 'Science', 'INT'],
    ['tactics', 'Tactics', 'INT'],
    ['wilderness', 'Wilderness Survival', 'INT'],
  ]],
  ['Fighting Skills', [
    ['brawling', 'Brawling', 'DEX'],
    ['evasion', 'Evasion', 'DEX'],
    ['martial_arts', 'Martial Arts', 'DEX', 2],
    ['melee_weapon', 'Melee Weapon', 'DEX'],
  ]],
  ['Performance Skills', [
    ['acting', 'Acting', 'COOL'],
    ['play_instrument', 'Play Instrument', 'TECH'],
  ]],
  ['Ranged Weapon Skills', [
    ['archery', 'Archery', 'REF'],
    ['autofire', 'Autofire', 'REF', 2],
    ['handgun', 'Handgun', 'REF'],
    ['heavy_weapons', 'Heavy Weapons', 'REF', 2],
    ['shoulder_arms', 'Shoulder Arms', 'REF'],
  ]],
  ['Social Skills', [
    ['bribery', 'Bribery', 'COOL'],
    ['conversation', 'Conversation', 'EMP'],
    ['human_perception', 'Human Perception', 'EMP'],
    ['interrogation', 'Interrogation', 'COOL'],
    ['persuasion', 'Persuasion', 'COOL'],
    ['personal_grooming', 'Personal Grooming', 'COOL'],
    ['streetwise', 'Streetwise', 'COOL'],
    ['trading', 'Trading', 'COOL'],
    ['wardrobe_style', 'Wardrobe & Style', 'COOL'],
  ]],
  ['Technique Skills', [
    ['air_vehicle_tech', 'Air Vehicle Tech', 'TECH'],
    ['basic_tech', 'Basic Tech', 'TECH'],
    ['cybertech', 'Cybertech', 'TECH'],
    ['demolitions', 'Demolitions', 'TECH', 2],
    ['electronics', 'Electronics/Security Tech', 'TECH', 2],
    ['first_aid', 'First Aid', 'TECH'],
    ['forgery', 'Forgery', 'TECH'],
    ['land_vehicle_tech', 'Land Vehicle Tech', 'TECH'],
    ['paint_draw', 'Paint/Draw/Sculpt', 'TECH'],
    ['paramedic', 'Paramedic', 'TECH', 2],
    ['photography', 'Photography/Film', 'TECH'],
    ['pick_lock', 'Pick Lock', 'TECH'],
    ['pick_pocket', 'Pick Pocket', 'TECH'],
    ['sea_vehicle_tech', 'Sea Vehicle Tech', 'TECH'],
    ['weaponstech', 'Weaponstech', 'TECH'],
  ]],
];

/** Split a list into `n` columns, filling top to bottom. */
function columns(ids, n) {
  const per = Math.ceil(ids.length / n);
  return Array.from({ length: n }, (_, i) => ids.slice(i * per, (i + 1) * per));
}

/** The preset, ready for normalizePreset(). Each call returns a fresh copy. */
export function build() {
  const fields = {};
  const field = (fid, type, label, extra = {}) => {
    fields[fid] = { id: fid, type, label, visibility: 'revealed', shown: '', rumor: { style: 'redacted', text: '' }, references: false, ...extra };
    return fid;
  };
  const number = (fid, label, value, extra) => field(fid, 'stat', label, { stat: 'fixed', default: { value }, ...extra });
  const pool = (fid, label, value, extra) => field(fid, 'stat', label, { stat: 'pool', default: { value, max: value }, ...extra });
  const text = (fid, label, value = '') => field(fid, 'longtext', label, { default: value });
  const section = (sid, title, cols, layout = 'columns') => ({ id: sid, title, layout, columns: cols });

  // Default fields: a player, human, medium-sized.
  field('category', 'category', 'Category', { default: 'player' });
  field('image', 'image', 'Portrait');
  field('name', 'text', 'Handle');
  field('species', 'text', 'Species', { default: 'Human' });
  field('size', 'size', 'Size', { default: 'Medium' });
  field('summary', 'shorttext', 'Short Description', { default: '' });

  // Role, beside the portrait.
  const main = [
    field('cpr_role', 'stat', 'Role', { stat: 'rarity', rarities: ROLES, default: { rarity: 'solo' } }),
    number('cpr_rank', 'Role Ability Rank', 4),
    text('cpr_role_ability', 'Role Ability'),
  ];

  const stats = STATS.map(([sid, label, kindOf]) => (kindOf === 'pool' ? pool(`cpr_${sid}`, label, 5) : number(`cpr_${sid}`, label, 5)));

  // With every STAT at 5: HP 10 + 5 × ⌈(BODY + WILL) / 2⌉ = 35, half of it rounded up = 18,
  // Death Save = BODY, Humanity = EMP × 10.
  const health = [
    [pool('cpr_hp', 'Hit Points', 35), number('cpr_seriously_wounded', 'Seriously Wounded (−2 to all actions)', 18)],
    [number('cpr_death_save', 'Death Save', 5), pool('cpr_humanity', 'Humanity', 50)],
    [text('cpr_critical_injuries', 'Critical Injuries'), text('cpr_addictions', 'Addictions')],
  ];

  const skillSections = SKILLS.map(([title, list]) => {
    const ids = list.map(([sid, label, stat, cost]) => number(`cpr_sk_${sid}`, `${label} (${stat}${cost ? ', ×2' : ''})`, 0));
    return section(`cpr_s_${title.split(' ')[0].toLowerCase()}`, `${title} (Skill Level)`, columns(ids, Math.min(3, ids.length)));
  });

  const sections = [
    section('cpr_s_stats', 'STATS', columns(stats, 3)),
    section('cpr_s_health', 'Hit Points & Humanity', health),
    ...skillSections,
    section('cpr_s_weapons', 'Weapons & Armor', [
      [text('cpr_weapons', 'Weapons', 'Weapon · DMG · Ammo · ROF · Notes\n')],
      [text('cpr_armor', 'Armor', 'Head: SP \nBody: SP \nShield: HP \nPenalty (applies to REF, DEX & MOVE): ')],
    ]),
    // As on the sheet: the body's own right side on the left of the figure, as you face it;
    // cyberware with no place on the body listed beside it.
    section('cpr_s_cyberware', 'Cyberware', [
      [text('cpr_cw_audio', 'Cyberaudio Suite')],
      [text('cpr_cw_eye_r', 'Right Cybereye'), text('cpr_cw_arm_r', 'Right Cyberarm'), text('cpr_cw_leg_r', 'Right Cyberleg')],
      [text('cpr_cw_eye_l', 'Left Cybereye'), text('cpr_cw_arm_l', 'Left Cyberarm'), text('cpr_cw_leg_l', 'Left Cyberleg')],
      [text('cpr_cw_neural', 'Neural Link')],
      [text('cpr_cw_internal', 'Internal Cyberware'), text('cpr_cw_external', 'External Cyberware'), text('cpr_cw_fashion', 'Fashionware'), text('cpr_cw_borg', 'Borgware')],
    ], 'body'),
    section('cpr_s_gear', 'Gear', [
      [text('cpr_gear', 'Gear', 'Name · Notes\n'), text('cpr_ammo', 'Ammunition')],
      [number('cpr_cash', 'Cash (eb)', 0), text('cpr_lifestyle', 'Lifestyle & Housing', 'Lifestyle: \nHousing: \nRent: ')],
    ]),
    section('cpr_s_reputation', 'Reputation', [
      [text('cpr_aliases', 'Aliases'), text('cpr_rep_events', 'Reputation Events')],
      [number('cpr_reputation', 'Reputation', 0), number('cpr_ip', 'Improvement Points', 0)],
    ]),
    section('cpr_s_lifepath', 'Lifepath', [
      [
        text('cpr_lp_origins', 'Cultural Origins'),
        text('cpr_lp_personality', 'Personality & Style', 'Personality: \nClothing style: \nHairstyle: \nAffectation: '),
        text('cpr_lp_values', 'Motivations', 'What do you value most? \nFeelings about people: \nMost valued person: \nMost valued possession: '),
      ],
      [
        text('cpr_lp_family', 'Family', 'Family background: \nChildhood environment: \nFamily crisis: '),
        text('cpr_lp_friends', 'Friends'),
        text('cpr_lp_enemies', 'Enemies', 'Who? \nWhat caused it? \nWhat can they throw at you? \nWhat’s gonna happen? '),
      ],
      [
        text('cpr_lp_love', 'Tragic Love Affairs'),
        text('cpr_lp_goals', 'Life Goals'),
        text('cpr_lp_role', 'Role-specific Lifepath'),
      ],
    ]),
    section('cpr_s_notes', 'Notes', [[text('cpr_notes', 'Notes')]]),
  ];

  const now = new Date().toISOString();
  return {
    format: PRESET_FORMAT, version: PRESET_VERSION, kind, id: 'preset_cpr_player', name, createdAt: now, updatedAt: now,
    fields, layout: { main, sections },
  };
}
