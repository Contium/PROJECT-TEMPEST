// Presets: user-defined templates for entity sheets, made in The Forge. Pure
// data + functions (no DOM), shared by the designer in the browser and by the
// server, which validates every save and import with normalizePreset().
//
// Each preset has a kind (see KINDS): characters (Characters/Creatures),
// stories (Stories/Rumors/Events) or items. A kind fixes the default fields, the
// categories an entity can be filed under, and which fields can be added.
//
// Preset {
//   format: 'tempest.preset', version: 1, kind, id, name, createdAt, updatedAt,
//   fields:  { [fieldId]: Field },
//   layout:  { main: [fieldId…], sections: [{ id, title, layout, columns: [[fieldId…], …] }] }
// }
// A section's layout is 'columns' (1–3 columns side by side) or 'body': a body
// diagram, with the figure art behind and the fields as boxes in front of it, in
// five zones (BODY_ZONES), stored as its five columns in that order.
// The kind's default fields always exist and sit at the top of the main section,
// in a fixed order; layout.main lists only the fields added below them. The
// 'category' default field (Category / Type) always holds one of the kind's
// categories: it decides which tab an entity forged from the preset lands in.
//
// Field (every type):
//   { id, type, label, visibility: revealed|shown|rumored, shown, rumor: { style, text }, references, default? }
//     shown       what players read instead of the contents when visibility is 'shown'
//     rumor       how the contents are obscured when 'rumored' (players still see the label)
//     references  the field carries GM-only links to other entities
// Type-specific settings: parent.parentType, gallery.{mode, autoplay, interval, cols, rows},
// stat.{stat, rarities}, rarity.{rarities} (items' fixed Rarity field), cast.{mode, sides}, location.{mode}.
//
// Values (on entities, and as defaults where a type has them), by field type:
//   text/shorttext/longtext string · category id · size name · date { y, m, d, time? } ·
//   image asset id · gallery [{ image, label? }] · parent { id } · stat (see cleanStat) · rarity { rarity } ·
//   cast combat { sides: [{ name, faction, members: [id] }] } / involved { people: [{ id, note }] } ·
//   location direct|indirect { id } / obscure { text }

export const PRESET_FORMAT = 'tempest.preset';
export const PRESET_VERSION = 1;

/** Where a character belongs: its Characters tab. */
export const CATEGORIES = [
  { id: 'player', label: 'Player', tab: 'players' },
  { id: 'npc', label: 'NPC', tab: 'npcs' },
  { id: 'monster', label: 'Monster', tab: 'monsters' },
  { id: 'creature', label: 'Creature', tab: 'creatures' },
];

/** Where a story belongs: its World tab. */
export const STORY_TYPES = [
  { id: 'story', label: 'Story', tab: 'stories' },
  { id: 'rumor', label: 'Rumor', tab: 'rumors' },
  { id: 'event', label: 'Event', tab: 'events' },
];

/** What a net card is: the node types of a NET architecture (Combat › Netrunning). All live on one tab. */
export const NET_CARD_TYPES = [
  { id: 'password', label: 'Password', tab: 'netrunning' },
  { id: 'file', label: 'File', tab: 'netrunning' },
  { id: 'control', label: 'Control Node', tab: 'netrunning' },
  { id: 'ice', label: 'Black ICE', tab: 'netrunning' },
  { id: 'demon', label: 'Demon', tab: 'netrunning' },
  { id: 'other', label: 'Other', tab: 'netrunning' },
];

export const SIZES = ['Miniscule', 'Nano', 'Tiny', 'Small', 'Medium', 'Large', 'Giant', 'Gargantuan', 'Colossal'];

/** What a Parent field may point at. */
export const PARENT_TYPES = [
  { id: 'any', label: 'Anything' },
  { id: 'character', label: 'Character' },
  { id: 'monster', label: 'Monster' },
  { id: 'creature', label: 'Creature' },
  { id: 'story', label: 'Story/Rumor/Event' },
  { id: 'item', label: 'Item' },
];

export const VISIBILITY = [
  { id: 'revealed', label: 'Revealed', hint: 'Players can read everything.' },
  { id: 'shown', label: 'Shown', hint: 'Players read what you write for them; the real contents stay hidden.' },
  { id: 'rumored', label: 'Rumored', hint: 'Players see the field name, but its contents are obscured.' },
];

export const OBSCURITY = [
  { id: 'redacted', label: 'Redacted bars' },
  { id: 'static', label: 'Static' },
  { id: 'text', label: 'Custom text' },
];

export const GALLERY_MODES = [
  { id: 'floors', label: 'Floors', hint: 'Up and down arrows, one image at a time' },
  { id: 'slideshow', label: 'Slideshow', hint: 'Left and right arrows; can cycle on its own' },
  { id: 'grid', label: 'Grid', hint: 'Images laid out in a grid of up to 3×3' },
];

export const STAT_KINDS = [
  { id: 'pool', label: 'Pool', hint: 'A bar with a value and a limit' },
  { id: 'fixed', label: 'Fixed number', hint: 'A single number' },
  { id: 'flex', label: 'Flexible pool', hint: 'A bar that can go beyond its limit' },
  { id: 'rarity', label: 'Rarity', hint: 'Pick one of the rarities you define' },
];

export const CAST_MODES = [
  { id: 'combat', label: 'Combat', hint: 'Up to three sides of a conflict, each with its faction and fighters' },
  { id: 'involved', label: 'Involved', hint: 'Characters who take part, each with an optional note on how' },
];

export const LOCATION_MODES = [
  { id: 'direct', label: 'Direct', hint: 'A location entry; players see its image once you reveal it' },
  { id: 'indirect', label: 'Indirect', hint: 'Any entry that stands for the place: a character, a story…' },
  { id: 'obscure', label: 'Obscure', hint: 'An empty picture frame and a short description of your own' },
];

export const SECTION_LAYOUTS = [
  { id: 'columns', label: 'Columns', hint: 'One to three columns side by side' },
  { id: 'body', label: 'Body diagram', hint: 'A figure behind the section, its fields as boxes around it: cyberware, wounds, armor' },
];

/** The places on a body diagram, in the order a body section stores them as columns. */
export const BODY_ZONES = [
  { id: 'top', label: 'Above the head' },
  { id: 'left', label: 'Left of the figure' },
  { id: 'right', label: 'Right of the figure' },
  { id: 'center', label: 'Over the hips' },
  { id: 'side', label: 'Beside the figure' },
];

/** What a section's column is called in menus: "Column 2", or a body zone's name. */
export function columnLabel(section, c) {
  if (section.layout === 'body') return BODY_ZONES[c]?.label ?? `Zone ${c + 1}`;
  return `Column ${c + 1}`;
}

export const RARITY_STYLES = [
  { id: 'plain', label: 'Plain' },
  { id: 'outline', label: 'Outline' },
  { id: 'glow', label: 'Glow' },
  { id: 'shimmer', label: 'Shimmer' },
];

/** The rarity ladder items start with (each preset can rename, recolour or extend it). */
export const ITEM_RARITIES = [
  { id: 'very_common', name: 'Very Common', color: '#8a8f98', style: 'plain' },
  { id: 'common', name: 'Common', color: '#c8ccd2', style: 'plain' },
  { id: 'uncommon', name: 'Uncommon', color: '#3fbf7f', style: 'outline' },
  { id: 'rare', name: 'Rare', color: '#4f8cff', style: 'outline' },
  { id: 'super_rare', name: 'Super Rare', color: '#22c3d6', style: 'glow' },
  { id: 'exotic', name: 'Exotic', color: '#e0569a', style: 'glow' },
  { id: 'legendary', name: 'Legendary', color: '#f5b041', style: 'shimmer' },
  { id: 'fabled', name: 'Fabled', color: '#a259ff', style: 'shimmer' },
  { id: 'mythic', name: 'Mythic', color: '#ff4d4d', style: 'shimmer' },
];

export const DEFAULT_RARITIES = [
  { id: 'common', name: 'Common', color: '#a9b1bb', style: 'plain' },
  { id: 'uncommon', name: 'Uncommon', color: '#3fbf7f', style: 'outline' },
  { id: 'rare', name: 'Rare', color: '#4f8cff', style: 'outline' },
  { id: 'epic', name: 'Epic', color: '#a259ff', style: 'glow' },
  { id: 'legendary', name: 'Legendary', color: '#f5b041', style: 'shimmer' },
];

/** Every field type that can be added to some kind of preset. */
export const ADDABLE = [
  { type: 'parent', label: 'Parent', hint: 'A link to the entry this one belongs to' },
  { type: 'longtext', label: 'Long Description', hint: 'A named block of text' },
  { type: 'image', label: 'Image', hint: 'One more picture' },
  { type: 'gallery', label: 'Gallery', hint: 'Several pictures: floors, slideshow or grid' },
  { type: 'stat', label: 'Stat', hint: 'Pool, fixed number, flexible pool or rarity' },
  { type: 'statblock', label: 'Stat Block', hint: 'A row of named numbers read together, like PER · SPD · ATK · DEF · REZ' },
  { type: 'cast', label: 'Characters', hint: 'Who takes part: the sides of a fight, or everyone involved' },
  { type: 'location', label: 'Location', hint: 'Where it happens: a location, any entry, or an obscure description' },
];

/**
 * The kinds of preset. Each lists its default fields (in order), its
 * categories (the 'category' field's choices, each mapped to a tab), the field
 * types that can be added, and how the top of the sheet is laid out (facts:
 * the defaults shown side by side under the name).
 */
export const KINDS = {
  characters: {
    label: 'Characters/Creatures', entity: 'character', entities: 'characters', idPrefix: 'char', section: 'characters',
    categories: CATEGORIES,
    defaults: [
      { id: 'category', type: 'category', label: 'Category', default: 'npc' },
      { id: 'image', type: 'image', label: 'Primary Image', primary: true },
      { id: 'name', type: 'text', label: 'Name' },
      { id: 'species', type: 'text', label: 'Species' },
      { id: 'size', type: 'size', label: 'Size', default: 'Medium' },
      { id: 'summary', type: 'shorttext', label: 'Short Description' },
    ],
    facts: ['species', 'size'],
    addable: ['parent', 'longtext', 'image', 'gallery', 'stat', 'statblock'],
  },
  stories: {
    label: 'Stories/Rumors/Events', entity: 'story', entities: 'stories', idPrefix: 'story', section: 'world',
    categories: STORY_TYPES,
    defaults: [
      { id: 'category', type: 'category', label: 'Type', default: 'event' },
      { id: 'image', type: 'image', label: 'Primary Image', primary: true },
      { id: 'name', type: 'text', label: 'Title' },
      { id: 'start', type: 'date', label: 'Start' },
      { id: 'end', type: 'date', label: 'End' },
      { id: 'summary', type: 'shorttext', label: 'Short Description' },
    ],
    facts: ['start', 'end'],
    addable: ['parent', 'longtext', 'image', 'gallery', 'stat', 'cast', 'location'],
  },
  items: {
    // No categories: items live in one Items list (filtered by rarity there).
    label: 'Items', entity: 'item', entities: 'items', idPrefix: 'item', section: 'items',
    categories: [],
    defaults: [
      { id: 'image', type: 'image', label: 'Primary Image', primary: true },
      { id: 'name', type: 'text', label: 'Name' },
      { id: 'itemtype', type: 'text', label: 'Item Type' },
      { id: 'rarity', type: 'rarity', label: 'Rarity' },
      { id: 'summary', type: 'shorttext', label: 'Short Description' },
    ],
    facts: ['itemtype', 'rarity'],
    addable: ['parent', 'longtext', 'image', 'gallery', 'stat', 'statblock'],
  },
  netcards: {
    // The pieces of a NET architecture (Combat › Netrunning › Card Forge), put together
    // in the Network Builder. Every type lives on the one Netrunning tab.
    label: 'Net Cards', entity: 'net card', entities: 'netcards', idPrefix: 'ncard', section: 'combat',
    categories: NET_CARD_TYPES,
    defaults: [
      { id: 'category', type: 'category', label: 'Type', default: 'ice' },
      { id: 'image', type: 'image', label: 'Primary Image', primary: true },
      { id: 'name', type: 'text', label: 'Name' },
      { id: 'dv', type: 'text', label: 'DV' },
      { id: 'summary', type: 'shorttext', label: 'Short Description' },
    ],
    facts: ['dv'],
    addable: ['longtext', 'image', 'gallery', 'stat', 'statblock'],
  },
};
export const PRESET_KINDS = Object.keys(KINDS);

export const kindOf = (presetOrKind) => KINDS[typeof presetOrKind === 'string' ? presetOrKind : presetOrKind?.kind] ?? KINDS.characters;
/** A kind's default field ids, in their fixed order. */
export const defaultIdsOf = (presetOrKind) => kindOf(presetOrKind).defaults.map((d) => d.id);
/** The categories a preset's 'category' field can hold. */
export const categoriesOf = (presetOrKind) => kindOf(presetOrKind).categories;
/** What can be added to a preset of this kind. */
export const addableOf = (presetOrKind) => kindOf(presetOrKind).addable.map((t) => ADDABLE.find((a) => a.type === t));

// The characters kind's defaults, kept under their old names for the code that predates kinds.
export const DEFAULT_FIELDS = KINDS.characters.defaults;
export const DEFAULT_IDS = defaultIdsOf('characters');

export const TYPE_LABELS = {
  category: 'Category', image: 'Image', text: 'Text', size: 'Size', shorttext: 'Short Description', date: 'Date', rarity: 'Rarity',
  parent: 'Parent', longtext: 'Long Description', gallery: 'Gallery', stat: 'Stat', statblock: 'Stat Block', cast: 'Characters', location: 'Location',
};

/** A Stat Block holds 1–12 stats; each value is a short text, so "4", "3d6" and "—" all fit. */
export const MAX_BLOCK_STATS = 12;
export const MAX_STAT_TEXT = 12;

// Full game sheets are long: the Cyberpunk RED template (app/forge/templates/) uses
// 123 fields, and this leaves room to extend it.
const MAX_FIELDS = 200;
const MAX_SECTIONS = 30;
const MAX_TEXT = 4000;
const MAX_LABEL = 60;
const MAX_RARITIES = 12;
const MAX_LINKS = 60;

export class PresetError extends Error {
  constructor(problems) {
    super(problems.length === 1 ? problems[0] : `This preset has ${problems.length} problems: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

// --- ids -----------------------------------------------------------------------------

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const newId = (prefix) => `${prefix}_${randomHex(4)}`;
export const PRESET_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
/** Any entity's id (char_…, story_…, and later loc_…, item_…). */
export const ENTITY_ID = /^[a-z]{2,8}_[0-9a-f]{8}$/;
export const ASSET_ID = /^img_[0-9a-f]{24}$/;

// --- construction ---------------------------------------------------------------------

const baseField = (id, type, label) => ({
  id, type, label, visibility: 'revealed', shown: '', rumor: { style: 'redacted', text: '' }, references: false,
});

/** A new field of an addable type, with sensible settings. */
export function newField(type, kind = 'characters') {
  const meta = ADDABLE.find((a) => a.type === type);
  if (!meta || !kindOf(kind).addable.includes(type)) throw new PresetError([`"${type}" is not a field type that can be added here`]);
  const field = baseField(newId('f'), type, meta.label);
  if (type === 'parent') Object.assign(field, { parentType: kind === 'characters' ? 'character' : 'any', label: 'Parent' });
  if (type === 'longtext') Object.assign(field, { label: 'Notes', default: '' });
  if (type === 'image') Object.assign(field, { label: 'Image' });
  if (type === 'gallery') Object.assign(field, { label: 'Gallery', mode: 'slideshow', autoplay: false, interval: 5, cols: 2, rows: 2 });
  if (type === 'stat') Object.assign(field, { label: 'Stat', stat: 'pool', default: { value: 10, max: 10 }, rarities: structuredClone(DEFAULT_RARITIES) });
  if (type === 'cast') Object.assign(field, { label: 'Characters', mode: 'involved', sides: ['Side A', 'Side B'] });
  if (type === 'location') Object.assign(field, { label: 'Location', mode: 'direct' });
  if (type === 'statblock') {
    Object.assign(field, { label: 'Stats', stats: ['STAT 1', 'STAT 2', 'STAT 3'].map((label, i) => ({ id: `s${i + 1}`, label })), default: {} });
  }
  return field;
}

/** A new stat for a Stat Block, with an id no other stat in it uses. */
export function newBlockStat(field, label = 'STAT') {
  let n = (field.stats?.length ?? 0) + 1;
  while (field.stats?.some((s) => s.id === `s${n}`)) n += 1;
  return { id: `s${n}`, label };
}

/** A blank preset of a kind, with just its default fields. */
export function newPreset(name = 'New preset', kind = 'characters') {
  const now = new Date().toISOString();
  const fields = Object.fromEntries(kindOf(kind).defaults.map((d) => [d.id, { ...baseField(d.id, d.type, d.label), ...d }]));
  return {
    format: PRESET_FORMAT, version: PRESET_VERSION, kind, id: newId('preset'), name, createdAt: now, updatedAt: now,
    fields, layout: { main: [], sections: [] },
  };
}

// --- layout editing (each returns a new preset) -------------------------------------------

const clone = (p) => structuredClone(p);
const isDefault = (preset, id) => defaultIdsOf(preset).includes(id);

/** Where a field sits: { area: 'main', index } | { area: 'section', section, column, index } | null. Defaults: { area: 'fixed' }. */
export function locate(preset, id) {
  if (isDefault(preset, id)) return { area: 'fixed', index: defaultIdsOf(preset).indexOf(id) };
  const i = preset.layout.main.indexOf(id);
  if (i !== -1) return { area: 'main', index: i };
  for (const s of preset.layout.sections) {
    for (let c = 0; c < s.columns.length; c++) {
      const j = s.columns[c].indexOf(id);
      if (j !== -1) return { area: 'section', section: s.id, column: c, index: j };
    }
  }
  return null;
}

/** The list a target names: { area: 'main' } or { area: 'section', section, column }. */
function listAt(preset, target) {
  if (!target || target.area === 'main') return preset.layout.main;
  const s = preset.layout.sections.find((x) => x.id === target.section);
  if (!s) throw new PresetError(['That section no longer exists']);
  return s.columns[Math.min(Math.max(target.column ?? 0, 0), s.columns.length - 1)];
}

function detach(preset, id) {
  const at = locate(preset, id);
  if (!at || at.area === 'fixed') return;
  listAt(preset, at).splice(at.index, 1);
}

/** Add a field of `type` at `target` (main by default). Returns { preset, id }. */
export function addField(preset, type, target = { area: 'main' }) {
  if (Object.keys(preset.fields).length >= MAX_FIELDS) throw new PresetError([`A preset holds at most ${MAX_FIELDS} fields`]);
  const p = clone(preset);
  const field = newField(type, p.kind);
  p.fields[field.id] = field;
  listAt(p, target).push(field.id);
  return { preset: p, id: field.id };
}

/** Move a field to `target` at `index` (end if omitted). Default fields don't move. */
export function moveField(preset, id, target, index) {
  if (isDefault(preset, id)) return preset;
  const p = clone(preset);
  const from = locate(p, id);
  detach(p, id);
  const list = listAt(p, target);
  let at = index ?? list.length;
  // Moving down within the same list: the removal shifted everything after it.
  const same = from && from.area === (target?.area ?? 'main') && (from.area === 'main' || (from.section === target.section && from.column === (target.column ?? 0)));
  if (same && index != null && from.index < index) at -= 1;
  list.splice(Math.max(0, Math.min(at, list.length)), 0, id);
  return p;
}

/** Nudge a field up (-1) or down (+1) within its list. */
export function nudgeField(preset, id, by) {
  const at = locate(preset, id);
  if (!at || at.area === 'fixed') return preset;
  const target = at.area === 'main' ? { area: 'main' } : { area: 'section', section: at.section, column: at.column };
  const to = at.index + by;
  if (to < 0 || to >= listAt(preset, target).length) return preset;
  return moveField(preset, id, target, by > 0 ? to + 1 : to);
}

export function removeField(preset, id) {
  if (isDefault(preset, id)) throw new PresetError(['Default fields cannot be removed']);
  const p = clone(preset);
  detach(p, id);
  delete p.fields[id];
  return p;
}

export function updateField(preset, id, patch) {
  const p = clone(preset);
  if (!p.fields[id]) return p;
  p.fields[id] = { ...p.fields[id], ...structuredClone(patch), id, type: p.fields[id].type };
  return p;
}

export function addSection(preset, title = 'New section') {
  if (preset.layout.sections.length >= MAX_SECTIONS) throw new PresetError([`A preset holds at most ${MAX_SECTIONS} sections`]);
  const p = clone(preset);
  const section = { id: newId('s'), title, layout: 'columns', columns: [[]] };
  p.layout.sections.push(section);
  return { preset: p, id: section.id };
}

export function updateSection(preset, sectionId, patch) {
  const p = clone(preset);
  const s = p.layout.sections.find((x) => x.id === sectionId);
  if (s && typeof patch.title === 'string') s.title = patch.title.slice(0, MAX_LABEL);
  return p;
}

/** Split a section into 1–3 columns; fields from dropped columns join the last remaining one. */
export function setColumns(preset, sectionId, count) {
  const n = Math.max(1, Math.min(3, Math.round(count)));
  const p = clone(preset);
  const s = p.layout.sections.find((x) => x.id === sectionId);
  if (!s || s.layout === 'body') return p; // a body diagram's zones are fixed
  while (s.columns.length < n) s.columns.push([]);
  while (s.columns.length > n) s.columns[n - 1].push(...s.columns.pop());
  return p;
}

/**
 * Switch a section between columns and a body diagram, keeping every field.
 * To a body: columns 1, 2 and 3 become the left, right and beside zones.
 * Back to columns: three columns, left / top and right / beside and hips.
 */
export function setSectionLayout(preset, sectionId, layout) {
  const p = clone(preset);
  const s = p.layout.sections.find((x) => x.id === sectionId);
  if (!s || !SECTION_LAYOUTS.some((l) => l.id === layout) || (s.layout ?? 'columns') === layout) return p;
  const c = s.columns;
  if (layout === 'body') {
    s.columns = [[], [...(c[0] ?? [])], [...(c[1] ?? [])], [], [...(c[2] ?? [])]];
  } else {
    const [top, left, right, center, side] = c;
    s.columns = [[...left, ...top], [...right], [...center, ...side]].filter((col, i) => i === 0 || col.length);
  }
  s.layout = layout;
  return p;
}

export function moveSection(preset, sectionId, by) {
  const p = clone(preset);
  const list = p.layout.sections;
  const i = list.findIndex((x) => x.id === sectionId);
  const j = i + by;
  if (i === -1 || j < 0 || j >= list.length) return p;
  [list[i], list[j]] = [list[j], list[i]];
  return p;
}

/** Remove a section and the fields in it. */
export function removeSection(preset, sectionId) {
  const p = clone(preset);
  const s = p.layout.sections.find((x) => x.id === sectionId);
  if (!s) return p;
  for (const id of s.columns.flat()) delete p.fields[id];
  p.layout.sections = p.layout.sections.filter((x) => x !== s);
  return p;
}

// --- validation ----------------------------------------------------------------------------

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, fallback, { min = -1e9, max = 1e9 } = {}) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const oneOf = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);
const HEX = /^#[0-9a-f]{6}$/i;
const FIELD_ID = /^[a-z][a-z0-9_]{1,31}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ref = (v) => (isObj(v) && ENTITY_ID.test(v.id ?? '') ? { id: v.id } : undefined);

function cleanRarities(list, problems, label, fallback = DEFAULT_RARITIES) {
  if (!Array.isArray(list) || !list.length) return structuredClone(fallback);
  const seen = new Set();
  const out = [];
  for (const r of list.slice(0, MAX_RARITIES)) {
    const name = str(r?.name, 30).trim();
    if (!name) {
      problems.push(`${label}: every rarity needs a name`);
      continue;
    }
    let id = FIELD_ID.test(r?.id ?? '') ? r.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || newId('r');
    if (!/^[a-z]/.test(id)) id = `r_${id}`;
    while (seen.has(id)) id = `${id}_2`;
    seen.add(id);
    out.push({ id, name, color: HEX.test(r?.color ?? '') ? r.color.toLowerCase() : '#a9b1bb', style: oneOf(r?.style, RARITY_STYLES, 'plain') });
  }
  return out.length ? out : structuredClone(fallback);
}

/**
 * An in-world date: { y, m, d, time? }. Years may be negative (before an
 * epoch); months and days run 1–99 so any calendar fits. Incomplete dates
 * keep what they have: a year alone, or a year and month, is fine.
 */
export function cleanDate(v) {
  if (!isObj(v) || !Number.isInteger(v.y) || Math.abs(v.y) > 1e6) return undefined;
  const out = { y: v.y };
  if (Number.isInteger(v.m) && v.m >= 1 && v.m <= 99) {
    out.m = v.m;
    if (Number.isInteger(v.d) && v.d >= 1 && v.d <= 99) out.d = v.d;
  }
  if (out.d && TIME.test(v.time ?? '')) out.time = v.time;
  return out;
}

/** Order two dates (missing parts count as earliest). */
export const compareDates = (a, b) => a.y - b.y || (a.m ?? 0) - (b.m ?? 0) || (a.d ?? 0) - (b.d ?? 0) || (a.time ?? '').localeCompare(b.time ?? '');

/** "1492-03-14 18:00", "1492-03", "-120" … */
export function formatDate(v) {
  if (!v) return '';
  const two = (n) => String(n).padStart(2, '0');
  return [String(v.y), v.m ? two(v.m) : null, v.d ? two(v.d) : null].filter(Boolean).join('-') + (v.time ? ` ${v.time}` : '');
}

function cleanStat(field, value) {
  if (field.stat === 'rarity' || field.type === 'rarity') return field.rarities.some((r) => r.id === value?.rarity) ? { rarity: value.rarity } : { rarity: field.rarities[0].id };
  const v = num(value?.value, 0);
  if (field.stat === 'fixed') return { value: v };
  const max = num(value?.max, 10, { min: 0 });
  return { value: field.stat === 'pool' ? Math.min(Math.max(v, 0), max) : Math.max(v, 0), max };
}

/** A Stat Block's value: { [statId]: text } for the stats it has, empty ones left out. */
function cleanBlock(field, value) {
  const out = {};
  if (isObj(value)) {
    for (const s of field.stats) {
      const v = value[s.id];
      const text = (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v, MAX_STAT_TEXT)).trim().slice(0, MAX_STAT_TEXT);
      if (text) out[s.id] = text;
    }
  }
  return out;
}

/** A Stat Block's stats: 1–12 { id, label }, ids unique, labels short. */
function cleanBlockStats(list) {
  const seen = new Set();
  const out = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, MAX_BLOCK_STATS)) {
    const label = str(s?.label, 16).trim() || 'STAT';
    let id = /^[a-z][a-z0-9_]{0,15}$/.test(s?.id ?? '') ? s.id : `s${out.length + 1}`;
    while (seen.has(id)) id = `${id}_2`.slice(-16);
    seen.add(id);
    out.push({ id, label });
  }
  return out.length ? out : [{ id: 's1', label: 'STAT' }];
}

/** A Characters field's value: the sides of a fight, or who's involved. */
function cleanCast(field, value) {
  if (!isObj(value)) return undefined;
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && ENTITY_ID.test(id)))].slice(0, MAX_LINKS);
  if (field.mode === 'combat') {
    const sides = field.sides.map((name, i) => {
      const s = Array.isArray(value.sides) ? value.sides[i] : null;
      return { name: str(s?.name, MAX_LABEL).trim() || name, faction: str(s?.faction, 80).trim(), members: ids(s?.members) };
    });
    return sides.some((s) => s.faction || s.members.length || s.name) ? { sides } : undefined;
  }
  const seen = new Set();
  const people = (Array.isArray(value.people) ? value.people : [])
    .filter((p) => p && ENTITY_ID.test(p.id ?? '') && !seen.has(p.id) && seen.add(p.id))
    .slice(0, MAX_LINKS)
    .map((p) => ({ id: p.id, ...(str(p.note, 400).trim() ? { note: str(p.note, 400).trim() } : {}) }));
  return people.length ? { people } : undefined;
}

function cleanLocation(field, value) {
  if (field.mode === 'obscure') {
    const text = str(value?.text, 400).trim();
    return text ? { text } : undefined;
  }
  return ref(value);
}

/** A preset's default for a field (only some types have one). */
function cleanDefault(field, value, kind) {
  switch (field.type) {
    case 'text':
    case 'shorttext':
    case 'longtext':
      return typeof value === 'string' ? value.slice(0, MAX_TEXT) : undefined;
    case 'size':
      return SIZES.includes(value) ? value : 'Medium';
    case 'category': {
      const cats = kind.categories;
      const fallback = kind.defaults.find((d) => d.id === 'category').default;
      return cats.some((c) => c.id === value) ? value : fallback;
    }
    case 'stat':
    case 'rarity':
      return cleanStat(field, value);
    case 'statblock':
      return cleanBlock(field, value);
    default:
      return undefined; // dates, images, galleries, links and locations are per entity
  }
}

/** Check one entity value against its field. Returns the clean value, or undefined for "not set". */
export function cleanValue(field, value, kind = 'characters') {
  const k = kindOf(kind);
  switch (field.type) {
    case 'date':
      return cleanDate(value);
    case 'image':
      return typeof value === 'string' && ASSET_ID.test(value) ? value : undefined;
    case 'gallery':
      if (!Array.isArray(value)) return undefined;
      return value
        .filter((x) => x && ASSET_ID.test(x.image ?? ''))
        .slice(0, 30)
        .map((x) => ({ image: x.image, ...(typeof x.label === 'string' && x.label.trim() ? { label: x.label.trim().slice(0, 60) } : {}) }));
    case 'parent':
      return ref(value);
    case 'cast':
      return cleanCast(field, value);
    case 'location':
      return cleanLocation(field, value);
    default:
      return cleanDefault(field, value, k);
  }
}

function cleanField(id, raw, problems, kind) {
  const known = kind.defaults.find((d) => d.id === id);
  const type = known?.type ?? raw?.type;
  if (!known && !kind.addable.includes(type)) {
    problems.push(ADDABLE.some((a) => a.type === type)
      ? `Field "${raw?.label ?? id}" (${TYPE_LABELS[type]}) can't be used in ${kind.label} presets`
      : `Field "${raw?.label ?? id}" has an unknown type "${type}"`);
    return null;
  }
  const label = str(raw?.label, MAX_LABEL).trim() || known?.label || TYPE_LABELS[type];
  const f = {
    ...baseField(id, type, label),
    visibility: oneOf(raw?.visibility, VISIBILITY, 'revealed'),
    shown: str(raw?.shown),
    rumor: { style: oneOf(raw?.rumor?.style, OBSCURITY, 'redacted'), text: str(raw?.rumor?.text, 200) },
    references: Boolean(raw?.references),
  };
  if (known?.primary) f.primary = true;
  if (type === 'parent') f.parentType = oneOf(raw?.parentType, PARENT_TYPES, kind === KINDS.characters ? 'character' : 'any');
  if (type === 'gallery') {
    Object.assign(f, {
      mode: oneOf(raw?.mode, GALLERY_MODES, 'slideshow'),
      autoplay: Boolean(raw?.autoplay),
      interval: Math.round(num(raw?.interval, 5, { min: 2, max: 60 })),
      cols: Math.round(num(raw?.cols, 2, { min: 1, max: 3 })),
      rows: Math.round(num(raw?.rows, 2, { min: 1, max: 3 })),
    });
  }
  if (type === 'stat') {
    f.stat = oneOf(raw?.stat, STAT_KINDS, 'pool');
    f.rarities = cleanRarities(raw?.rarities, problems, label);
  }
  if (type === 'rarity') {
    // Always a rarity pick: the stat editors and badges work on it unchanged.
    f.stat = 'rarity';
    f.rarities = cleanRarities(raw?.rarities, problems, label, ITEM_RARITIES);
  }
  if (type === 'cast') {
    f.mode = oneOf(raw?.mode, CAST_MODES, 'involved');
    const sides = (Array.isArray(raw?.sides) ? raw.sides : []).slice(0, 3).map((s, i) => str(s, MAX_LABEL).trim() || `Side ${'ABC'[i]}`);
    f.sides = sides.length ? sides : ['Side A', 'Side B'];
  }
  if (type === 'location') f.mode = oneOf(raw?.mode, LOCATION_MODES, 'direct');
  if (type === 'statblock') f.stats = cleanBlockStats(raw?.stats);
  const value = cleanDefault(f, raw?.default ?? known?.default, kind);
  if (value !== undefined) f.default = value;
  return f;
}

/**
 * Check and tidy a preset (from the designer, a saved file, or an import).
 * Unknown keys are dropped, limits applied, and the layout made consistent:
 * default fields always exist, every other field is placed exactly once, and
 * layout entries that name no field are dropped. Throws PresetError for
 * anything that can't be repaired.
 */
export function normalizePreset(input) {
  const problems = [];
  if (!isObj(input)) throw new PresetError(['A preset must be a JSON object']);
  if (input.format != null && input.format !== PRESET_FORMAT) problems.push('This file is not a TEMPEST preset');
  if (input.version != null && input.version > PRESET_VERSION) problems.push(`This preset was made by a newer TEMPEST (format ${input.version})`);
  const kindId = input.kind ?? 'characters';
  if (!PRESET_KINDS.includes(kindId)) problems.push(`Unknown preset kind "${kindId}"`);
  const name = str(input.name, 80).trim();
  if (!name) problems.push('A preset needs a name');
  const rawFields = isObj(input.fields) ? input.fields : {};
  if (Object.keys(rawFields).length > MAX_FIELDS) problems.push(`A preset holds at most ${MAX_FIELDS} fields`);
  if (problems.length) throw new PresetError(problems);

  const kind = KINDS[kindId];
  const fields = {};
  for (const d of kind.defaults) fields[d.id] = cleanField(d.id, rawFields[d.id], problems, kind);
  const placed = new Set(kind.defaults.map((d) => d.id));
  const take = (ids) => {
    const out = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || placed.has(id) || !FIELD_ID.test(id) || !rawFields[id]) continue;
      placed.add(id); // even if it fails: report each broken field once
      const f = cleanField(id, rawFields[id], problems, kind);
      if (!f) continue;
      fields[id] = f;
      out.push(id);
    }
    return out;
  };
  const layout = isObj(input.layout) ? input.layout : {};
  const main = take(layout.main);
  const sections = (Array.isArray(layout.sections) ? layout.sections : []).slice(0, MAX_SECTIONS).map((s) => {
    const sectionLayout = oneOf(s?.layout, SECTION_LAYOUTS, 'columns');
    const raw = Array.isArray(s?.columns) && s.columns.length ? s.columns : [[]];
    // A body diagram always has its five zones; columns run one to three.
    const columns = sectionLayout === 'body'
      ? BODY_ZONES.map((_, i) => take(raw[i]))
      : raw.slice(0, 3).map(take);
    return { id: FIELD_ID.test(s?.id ?? '') ? s.id : newId('s'), title: str(s?.title, MAX_LABEL), layout: sectionLayout, columns };
  });
  // Fields that exist but aren't placed anywhere join the main section, so nothing is lost.
  for (const id of Object.keys(rawFields)) if (!placed.has(id) && FIELD_ID.test(id)) main.push(...take([id]));
  if (problems.length) throw new PresetError(problems);

  const now = new Date().toISOString();
  return {
    format: PRESET_FORMAT, version: PRESET_VERSION, kind: kindId,
    id: PRESET_ID.test(input.id ?? '') ? input.id : newId('preset'),
    name,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
    fields,
    layout: { main, sections },
  };
}

/** Every field in reading order: defaults, main, then sections left to right. */
export function fieldsInOrder(preset) {
  return [...defaultIdsOf(preset), ...preset.layout.main, ...preset.layout.sections.flatMap((s) => s.columns.flat())].map((id) => preset.fields[id]).filter(Boolean);
}
