// Entity type definitions and field validation.
//
// A type is { id, name, plural, lexKey?, category, fields: FieldDef[] }.
// FieldDef is { key, label, type, refType?, options?, secret?, required?, role?, hint? }:
//   refType   a type id or list of ids a ref/refs field may point to (omit = any)
//   secret    never shown in the player view
//   required  must be set on create and can't be cleared
//   role      'parent' marks the containment link that builds breadcrumbs and the Atlas
// Entities may also carry keys their type doesn't declare (free-form custom fields).

const { badRequest } = require('./errors');

const FIELD_TYPES = ['text', 'longtext', 'number', 'bool', 'enum', 'tier', 'meter', 'ref', 'refs', 'tags', 'gametime', 'image', 'gallery'];
// A gallery is a labelled list of images, each revealed to players or not:
// [{ image: '<asset id>', label?: 'Ground floor', revealed?: true }]
const GALLERY_KEYS = new Set(['image', 'label', 'revealed']);
const VISIBILITY = ['hidden', 'rumored', 'known'];
const CATEGORIES = ['chronicle', 'cosmos', 'powers', 'lands', 'people', 'play', 'extra'];
const TYPE_ID = /^[a-z][a-z0-9_]{1,31}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,47}$/;

const f = (key, type, label, extra = {}) => ({ key, type, label, ...extra });
const parent = (label, refType, hint) => f('parent', 'ref', label, { refType, role: 'parent', ...(hint ? { hint } : {}) });

// Groups of types that commonly appear as link targets.
const SPACES = ['system', 'world', 'nation', 'region', 'community', 'place'];
const ORGS = ['global_faction', 'nation', 'regional_faction', 'group', 'team'];
const DISPOSITIONS = ['hostile', 'unfriendly', 'neutral', 'friendly', 'allied'];

// Combat stats the Initiative Tracker copies when someone joins a fight.
// GM-only by default: players see their own numbers in the tracker, not dossiers.
const COMBAT = [
  f('hp', 'number', 'Hit points', { lexKey: 'hp', secret: true, hint: 'Maximum' }),
  f('armor', 'number', 'Armor', { lexKey: 'armor', secret: true, hint: 'Armor Class, Stopping Power…' }),
  f('initiative', 'number', 'Initiative bonus', { secret: true, hint: 'Added to a d20 when the tracker rolls initiative' }),
  f('slots', 'text', 'Ability slots', { lexKey: 'slots', secret: true, hint: 'Uses per pool: "4 3 2" for 1st–3rd level spells, or "Ki 5, Rage 3"' }),
];

// Shared tail for every in-world type.
const COMMON = [
  f('tags', 'tags', 'Tags'),
  f('rumor', 'longtext', 'Rumour', { hint: 'What players hear while this is only rumoured' }),
  f('gm_notes', 'longtext', 'GM Notes', { secret: true }),
];

// Order here is the order the app presents them in (the Universe's own
// reading order); `category` groups them in navigation.
const CORE_TYPES = [
  {
    id: 'era', name: 'Era', plural: 'Eras', lexKey: 'era', category: 'chronicle',
    fields: [
      f('start', 'gametime', 'Begins', { required: true }),
      f('end', 'gametime', 'Ends', { hint: 'Leave empty if the era is still going' }),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'system', name: 'System', plural: 'Systems', lexKey: 'system', category: 'cosmos',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Star system, plane of existence, pocket dimension…' }),
      parent('Part of', ['system'], 'A cluster, galaxy or outer plane that contains this one'),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'world', name: 'World', plural: 'Worlds', lexKey: 'world', category: 'cosmos',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Planet, moon, station, realm, layer…' }),
      parent('In system', ['system']),
      f('population', 'number', 'Population'),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'religion', name: 'Religion', plural: 'Religions', lexKey: 'religion', category: 'powers',
    fields: [
      parent('Branch of', ['religion'], 'For sects and denominations'),
      f('deities', 'text', 'Deities / focus'),
      f('tier', 'tier', 'Influence'),
      f('origin', 'ref', 'Originated in', { refType: SPACES }),
      f('tenets', 'longtext', 'Tenets'),
      f('summary', 'longtext', 'Summary'),
      f('secrets', 'longtext', 'Hidden truths', { secret: true }),
      ...COMMON,
    ],
  },
  {
    id: 'global_faction', name: 'Global Faction', plural: 'Global Factions', lexKey: 'global_faction', category: 'powers',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Alliance, bloc, megacorp, order…' }),
      f('tier', 'tier', 'Power'),
      parent('Sphere', ['system', 'world'], 'The widest space it operates in'),
      f('members', 'refs', 'Members', { refType: ['nation', 'regional_faction', 'group'] }),
      f('leader', 'ref', 'Leader', { refType: ['individual'] }),
      f('headquarters', 'ref', 'Headquarters', { refType: SPACES }),
      f('summary', 'longtext', 'Summary'),
      f('goals', 'longtext', 'Goals', { secret: true }),
      ...COMMON,
    ],
  },
  {
    id: 'nation', name: 'Nation', plural: 'Nations', lexKey: 'nation', category: 'powers',
    fields: [
      parent('On world', ['world', 'system']),
      f('government', 'text', 'Government'),
      f('tier', 'tier', 'Power'),
      f('capital', 'ref', 'Capital', { refType: ['community'] }),
      f('leader', 'ref', 'Leader', { refType: ['individual'] }),
      f('population', 'number', 'Population'),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'regional_faction', name: 'Regional Faction', plural: 'Regional Factions', lexKey: 'regional_faction', category: 'powers',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Government, council, police, authority…' }),
      parent('Governs', ['nation', 'region', 'community', 'world']),
      f('tier', 'tier', 'Power'),
      f('leader', 'ref', 'Leader', { refType: ['individual'] }),
      f('seat', 'ref', 'Seat', { refType: ['community', 'place'] }),
      f('summary', 'longtext', 'Summary'),
      f('goals', 'longtext', 'Goals', { secret: true }),
      ...COMMON,
    ],
  },
  {
    id: 'region', name: 'Region', plural: 'Regions', lexKey: 'region', category: 'lands',
    fields: [
      parent('Part of', ['nation', 'world', 'region']),
      f('population', 'number', 'Population'),
      f('threat', 'tier', 'Threat', { lexKey: 'threat' }),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'community', name: 'Community', plural: 'Communities', lexKey: 'community', category: 'lands',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'City, town, village, district, station, habitat…' }),
      parent('Located in', ['region', 'nation', 'world', 'community']),
      f('population', 'number', 'Population'),
      f('threat', 'tier', 'Threat', { lexKey: 'threat' }),
      f('governed_by', 'ref', 'Governed by', { refType: ['regional_faction', 'nation', 'group'] }),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'event', name: 'Event', plural: 'Events', lexKey: 'event', category: 'chronicle',
    fields: [
      f('summary', 'longtext', 'Summary'),
      f('location', 'ref', 'Where', { refType: SPACES }),
      f('participants', 'refs', 'Involved'),
      f('severity', 'tier', 'Severity'),
      ...COMMON,
    ],
  },
  {
    id: 'place', name: 'Place', plural: 'Places', lexKey: 'place', category: 'lands',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Bar, temple, ruin, starport, clinic…' }),
      parent('Located in', ['community', 'region', 'world', 'system', 'place']),
      f('owner', 'ref', 'Owner', { refType: [...ORGS, 'individual'] }),
      f('threat', 'tier', 'Threat', { lexKey: 'threat' }),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    id: 'group', name: 'Group', plural: 'Groups', lexKey: 'group', category: 'people',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Gang, corporation, guild, cult, company…' }),
      f('tier', 'tier', 'Power'),
      parent('Answers to', ['global_faction', 'regional_faction', 'group', 'nation'], 'The larger organisation it belongs to, if any'),
      f('base', 'ref', 'Based in', { refType: SPACES }),
      f('leader', 'ref', 'Leader', { refType: ['individual'] }),
      f('resources', 'number', 'Resources'),
      f('summary', 'longtext', 'Summary'),
      f('goals', 'longtext', 'Goals', { secret: true }),
      ...COMMON,
    ],
  },
  {
    id: 'team', name: 'Team', plural: 'Teams', lexKey: 'team', category: 'people',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Crew, squad, party, cell…' }),
      parent('Part of', ['group', 'regional_faction', 'global_faction', 'nation']),
      f('leader', 'ref', 'Leader', { refType: ['individual'] }),
      f('base', 'ref', 'Based in', { refType: SPACES }),
      f('summary', 'longtext', 'Summary'),
      ...COMMON,
    ],
  },
  {
    // Direct relationships between any two entities: friendships, debts,
    // rivalries, control shares… Tracked through history like everything else.
    id: 'relation', name: 'Relationship', plural: 'Relationships', lexKey: 'relation', category: 'people',
    fields: [
      f('from', 'ref', 'From', { required: true }),
      f('to', 'ref', 'To', { required: true }),
      f('kind', 'text', 'Kind', { required: true, hint: 'mentor of, owes, rival of, controls…' }),
      f('value', 'number', 'Strength', { hint: 'e.g. 0.62 for 62% control, -2 for a grudge, +3 for loyalty' }),
      f('summary', 'longtext', 'Details'),
      f('gm_notes', 'longtext', 'GM Notes', { secret: true }),
    ],
  },
  {
    id: 'individual', name: 'Individual', plural: 'Individuals', lexKey: 'individual', category: 'people',
    fields: [
      f('role', 'text', 'Role'),
      f('pc', 'bool', 'Player character', { hint: 'Joins the Initiative Tracker on the players\' side, and stays in it between fights' }),
      f('player', 'text', 'Played by'),
      f('tier', 'tier', 'Importance'),
      f('affiliation', 'ref', 'Primary affiliation', { refType: ORGS }),
      f('memberships', 'refs', 'Also member of', { refType: ORGS }),
      f('location', 'ref', 'Usually at', { refType: SPACES }),
      f('nation', 'ref', 'Citizen of', { refType: ['nation'] }),
      f('religion', 'ref', 'Faith', { refType: ['religion'] }),
      f('status', 'enum', 'Status', { options: ['alive', 'injured', 'missing', 'dead'] }),
      f('disposition', 'enum', 'Disposition to party', { options: DISPOSITIONS }),
      ...COMBAT,
      f('summary', 'longtext', 'Summary'),
      f('motive', 'longtext', 'Motive', { secret: true }),
      ...COMMON,
    ],
  },
  {
    // Mooks and stat-blocked foes. One entry can join a fight many times
    // (Raider #1, Raider #2…); individuals are for people who matter.
    id: 'combatant', name: 'Mob', plural: 'Mobs', lexKey: 'combatant', category: 'people',
    fields: [
      f('kind', 'text', 'Kind', { hint: 'Ganger, wolf, security drone…' }),
      f('tier', 'tier', 'Threat', { lexKey: 'threat' }),
      f('affiliation', 'ref', 'Fights for', { refType: ORGS }),
      f('side', 'enum', 'Joins fights as', { options: ['enemy', 'ally', 'neutral'], hint: 'Default side in the Initiative Tracker (enemy if empty)' }),
      ...COMBAT,
      f('attacks', 'longtext', 'Attacks & abilities', { secret: true }),
      f('summary', 'longtext', 'Description'),
      ...COMMON,
    ],
  },
  {
    id: 'campaign', name: 'Campaign', plural: 'Campaigns', lexKey: 'campaign', category: 'play',
    fields: [
      f('status', 'enum', 'Status', { options: ['planning', 'active', 'paused', 'finished'] }),
      f('era', 'ref', 'Era', { refType: ['era'] }),
      f('party', 'ref', 'Party', { refType: ['team'] }),
      f('started', 'gametime', 'In-game start'),
      f('summary', 'longtext', 'Premise'),
      f('gm_notes', 'longtext', 'GM Notes', { secret: true }),
    ],
  },
  {
    id: 'session', name: 'Session', plural: 'Sessions', lexKey: 'session', category: 'play',
    fields: [
      f('campaign', 'ref', 'Campaign', { refType: ['campaign'] }),
      f('number', 'number', 'Number'),
      f('started', 'gametime', 'In-game start'),
      f('ended', 'gametime', 'In-game end'),
      f('played_on', 'text', 'Played on'),
      f('summary', 'longtext', 'Recap'),
      f('gm_notes', 'longtext', 'GM Notes', { secret: true }),
    ],
  },
  {
    // In-world press: screamsheets, broadsheets, HoloNet bulletins. Name = headline.
    id: 'article', name: 'Article', plural: 'Articles', lexKey: 'article', category: 'play',
    fields: [
      f('outlet', 'text', 'Outlet', { hint: 'Who published it, e.g. Night City Today' }),
      f('byline', 'text', 'Byline'),
      f('layout', 'enum', 'Layout', { options: ['broadsheet', 'crt', 'plain'], hint: 'How it looks on the player screen' }),
      f('body', 'longtext', 'Article'),
      f('mentions', 'refs', 'Mentions'),
      ...COMMON,
    ],
  },
  {
    id: 'item', name: 'Item', plural: 'Items', lexKey: 'item', category: 'extra',
    fields: [
      f('summary', 'longtext', 'Summary'),
      f('tier', 'tier', 'Rarity'),
      f('holder', 'ref', 'Held by'),
      f('value', 'number', 'Value', { lexKey: 'currency' }),
      ...COMMON,
    ],
  },
];

// Every in-world level leads with a picture; the label says what kind.
const IMAGE_LABELS = {
  era: 'Image', system: 'Image', world: 'Image', religion: 'Symbol', global_faction: 'Emblem', nation: 'Flag',
  regional_faction: 'Emblem', region: 'Map', community: 'Image', event: 'Image', place: 'Image', group: 'Emblem',
  team: 'Emblem', individual: 'Portrait', combatant: 'Portrait', campaign: 'Cover', article: 'Image', item: 'Image',
};
for (const type of CORE_TYPES) {
  if (IMAGE_LABELS[type.id]) type.fields.unshift(f('image', 'image', IMAGE_LABELS[type.id]));
}

// Places, sessions and in-world press carry labelled maps (floor plans, routes,
// handouts). Players only ever receive the ones marked revealed.
const MAP_TYPES = ['place', 'session', 'article'];
for (const type of CORE_TYPES) {
  if (!MAP_TYPES.includes(type.id)) continue;
  const before = type.fields.findIndex((fd) => fd.key === 'tags' || fd.key === 'gm_notes');
  type.fields.splice(before === -1 ? type.fields.length : before, 0,
    f('maps', 'gallery', 'Maps', { hint: 'Reveal a map to include it in what players see; push any map full-screen at any time' }));
}

const refTypesOf = (field) => (field.refType == null ? null : [].concat(field.refType));

function validateTypeDef(def) {
  const errors = [];
  if (!TYPE_ID.test(def.id ?? '')) errors.push('id must be lowercase letters, digits or _ (2–32 chars)');
  if (!def.name) errors.push('name is required');
  if (def.category != null && !CATEGORIES.includes(def.category)) errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!Array.isArray(def.fields)) errors.push('fields must be an array');
  const seen = new Set();
  for (const field of def.fields ?? []) {
    if (!FIELD_KEY.test(field.key ?? '')) errors.push(`field key "${field.key}" is invalid`);
    if (seen.has(field.key)) errors.push(`field "${field.key}" is defined twice`);
    seen.add(field.key);
    if (!FIELD_TYPES.includes(field.type)) errors.push(`field "${field.key}" has unknown type "${field.type}"`);
    if (field.type === 'enum' && !(Array.isArray(field.options) && field.options.length)) {
      errors.push(`enum field "${field.key}" needs options`);
    }
    if (field.role === 'parent' && (field.key !== 'parent' || field.type !== 'ref')) errors.push('the containment field must be a ref named "parent"');
  }
  if (errors.length) throw badRequest(`Invalid type "${def.id}": ${errors.join('; ')}`, errors);
}

function checkValue(field, value) {
  if (value === null) return null; // null always means "unset"
  const isStr = typeof value === 'string';
  switch (field.type) {
    case 'text':
    case 'longtext':
      return isStr ? null : 'must be text';
    case 'number':
      return Number.isFinite(value) ? null : 'must be a number';
    case 'bool':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return field.options.includes(value) ? null : `must be one of ${field.options.join(', ')}`;
    case 'tier':
      return Number.isInteger(value) && value >= 1 && value <= 5 ? null : 'must be a whole number 1–5';
    case 'meter':
      return Number.isFinite(value) && value >= 0 && value <= 1 ? null : 'must be between 0 and 1';
    case 'gametime':
      return Number.isInteger(value) ? null : 'must be whole minutes of game time';
    case 'ref':
      return isStr ? null : 'must be an entity id';
    case 'image':
      return isStr ? null : 'must be an uploaded image id';
    case 'gallery':
      return Array.isArray(value) &&
        value.every((item) => item && typeof item === 'object' && typeof item.image === 'string' &&
          (item.label == null || typeof item.label === 'string') &&
          (item.revealed == null || typeof item.revealed === 'boolean') &&
          Object.keys(item).every((k) => GALLERY_KEYS.has(k)))
        ? null
        : 'must be a list of { image, label, revealed }';
    case 'refs':
    case 'tags':
      return Array.isArray(value) && value.every((v) => typeof v === 'string') ? null : 'must be a list of strings';
    default:
      return null;
  }
}

/**
 * Validate a data object against a type. `creating` additionally enforces
 * required fields; on update, required fields can't be cleared.
 */
function validateData(type, data, { creating = false } = {}) {
  const errors = [];
  const fields = new Map(type.fields.map((fd) => [fd.key, fd]));
  for (const [key, value] of Object.entries(data)) {
    if (!FIELD_KEY.test(key)) {
      errors.push(`"${key}" is not a valid field name`);
      continue;
    }
    const field = fields.get(key);
    if (field?.required && value === null) {
      errors.push(`${field.label} is required`);
      continue;
    }
    const problem = field ? checkValue(field, value) : value === undefined ? 'cannot be undefined' : null;
    if (problem) errors.push(`${field?.label ?? key} ${problem}`);
  }
  if (creating) {
    for (const field of type.fields) if (field.required && data[field.key] == null) errors.push(`${field.label} is required`);
  }
  if (errors.length) throw badRequest(`Invalid ${type.name} data: ${errors.join('; ')}`, errors);
}

/** [{ key, id, refTypes }] for every ref / refs value present in data. */
function refsIn(type, data) {
  const out = [];
  for (const field of type.fields) {
    const value = data[field.key];
    if (value == null) continue;
    const refTypes = refTypesOf(field);
    if (field.type === 'ref') out.push({ key: field.key, label: field.label, id: value, refTypes });
    if (field.type === 'refs') value.forEach((id) => out.push({ key: field.key, label: field.label, id, refTypes }));
  }
  return out;
}

/** Image asset ids present in data (single images and gallery items). */
function imagesIn(type, data) {
  return type.fields.flatMap((fd) => {
    const value = data[fd.key];
    if (fd.type === 'image' && typeof value === 'string') return [{ label: fd.label, id: value }];
    if (fd.type === 'gallery' && Array.isArray(value)) return value.map((item) => ({ label: fd.label, id: item.image }));
    return [];
  });
}

module.exports = { FIELD_TYPES, VISIBILITY, CATEGORIES, CORE_TYPES, validateTypeDef, validateData, refsIn, refTypesOf, imagesIn };
