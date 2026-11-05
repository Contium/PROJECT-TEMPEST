// Entities: what The Forge makes from a preset (characters from Characters/
// Creatures presets, stories from Stories/Rumors/Events presets). Shared by the
// browser and the server, which checks every save with normalizeEntity().
//
// Entity {
//   format: 'tempest.entity', version: 1, kind, id, name, category,
//   presetId, presetName,                 where it was forged from (informational)
//   sheet: { kind, fields, layout },      a snapshot of the preset's structure, so later
//                                         preset edits never break existing entities
//   values: { [fieldId]: value },         what was filled in (shapes: see preset-model.js)
//   shown:  { [fieldId]: text },          per-entity "players read" text for Shown fields
//   refs:   { [fieldId]: [entityId] },    GM-only references, on fields that allow them
//   known:  true when the players know of it: it's in their Codex on the player screens
//           (as its sheet allows). Pushing an entry makes it known.
//   createdAt, updatedAt
// }
// name and category mirror values.name / values.category, for listing; the
// category decides the entity's tab (KINDS[kind].categories).
// Ids are prefixed by kind (char_…, story_…) so any link knows what it points at.

import { normalizePreset, cleanValue, PresetError, newId, fieldsInOrder, kindOf, KINDS, ENTITY_ID, ASSET_ID } from './preset-model.js';

export const ENTITY_FORMAT = 'tempest.entity';
export const ENTITY_VERSION = 1;
export { ENTITY_ID, ASSET_ID };
const MAX_REFS = 30;

/** The kind an entity id belongs to ('characters' for char_…), or null. */
export const kindOfId = (id) => Object.entries(KINDS).find(([, k]) => String(id).startsWith(`${k.idPrefix}_`))?.[0] ?? null;
export const idPattern = (kind) => new RegExp(`^${kindOf(kind).idPrefix}_[0-9a-f]{8}$`);

/** The category record ({ id, label, tab }) of a kind. */
export const categoryOf = (kind, id) => kindOf(kind).categories.find((c) => c.id === id);
/** The category shown on a tab, by tab id (any kind). Returns { kind, category } or null. */
export function categoryForTab(tabId) {
  for (const [kind, k] of Object.entries(KINDS)) {
    const category = k.categories.find((c) => c.tab === tabId);
    if (category) return { kind, category };
  }
  return null;
}
/** A category label's plural, for tab and list text: NPCs, Stories, Rumors… */
export const plural = (label) => (/[^aeiou]y$/i.test(label) ? `${label.slice(0, -1)}ies` : `${label}s`);

/** Where an entity's page is: #/<section>/<tab>/<id> (items: #/items/<id>). */
export const hrefOf = (e) => {
  const kind = e.kind ?? kindOfId(e.id) ?? 'characters';
  const k = kindOf(kind);
  if (!k.categories.length) return `#/${k.section}/${e.id}`; // items: one list, no tabs
  const tab = categoryOf(kind, e.category)?.tab ?? k.categories[0].tab;
  return `#/${k.section}/${tab}/${e.id}`;
};

/** Starting values for a sheet: each field's default. */
export function defaultValues(sheet) {
  const values = {};
  for (const f of fieldsInOrder(sheet)) if (f.default !== undefined) values[f.id] = structuredClone(f.default);
  return values;
}

/** An entity from a preset and the values filled in for it. */
export function forge(preset, { values = {}, shown = {}, refs = {} } = {}) {
  const now = new Date().toISOString();
  const kind = preset.kind ?? 'characters';
  return normalizeEntity({
    format: ENTITY_FORMAT, version: ENTITY_VERSION, kind, id: newId(kindOf(kind).idPrefix),
    presetId: preset.id ?? null, presetName: preset.name ?? '',
    sheet: { kind, fields: preset.fields, layout: preset.layout },
    values, shown, refs, createdAt: now, updatedAt: now,
  });
}

/** Check and tidy an entity. Throws PresetError (with problems) for what can't be repaired. */
export function normalizeEntity(input, { kind: expected } = {}) {
  if (!input || typeof input !== 'object') throw new PresetError(['An entry must be a JSON object']);
  const problems = [];
  // Characters made before kinds existed say 'tempest.character' and have no kind.
  if (input.format != null && input.format !== ENTITY_FORMAT && input.format !== 'tempest.character') problems.push('This is not a TEMPEST entry');
  if (input.version != null && input.version > ENTITY_VERSION) problems.push(`This entry was made by a newer TEMPEST (format ${input.version})`);
  const kind = input.kind ?? input.sheet?.kind ?? 'characters';
  if (!KINDS[kind]) problems.push(`Unknown kind "${kind}"`);
  if (expected && kind !== expected) problems.push(`This is a ${kindOf(kind).entity}, not a ${kindOf(expected).entity}`);
  if (problems.length) throw new PresetError(problems);

  // The sheet is a preset in all but name: the same rules apply.
  const sheet = normalizePreset({ name: input.presetName || 'Sheet', kind, fields: input.sheet?.fields, layout: input.sheet?.layout });
  const fields = fieldsInOrder(sheet);
  const raw = input.values && typeof input.values === 'object' ? input.values : {};
  const values = {};
  for (const f of fields) {
    const v = cleanValue(f, raw[f.id], kind);
    if (v !== undefined) values[f.id] = v;
  }
  values.name = (values.name ?? '').trim();
  if (!values.name) problems.push(`A ${kindOf(kind).entity} needs a ${sheet.fields.name.label.toLowerCase()}`);

  // Shown text is kept even while its field is Revealed, Obscured or Hidden, so switching the
  // field back to Shown (or undoing a Hide all) finds the GM's words again. Players only ever
  // get it through playerEntity(), and only for fields that are Shown.
  const shown = {};
  for (const f of fields) {
    const text = input.shown?.[f.id];
    if (typeof text === 'string' && text) shown[f.id] = text.slice(0, 4000);
  }
  const refs = {};
  for (const f of fields) {
    const ids = input.refs?.[f.id];
    if (!f.references || !Array.isArray(ids)) continue;
    const clean = [...new Set(ids.filter((id) => typeof id === 'string' && ENTITY_ID.test(id)))].slice(0, MAX_REFS);
    if (clean.length) refs[f.id] = clean;
  }
  if (problems.length) throw new PresetError(problems);

  const now = new Date().toISOString();
  const pattern = idPattern(kind);
  return {
    format: ENTITY_FORMAT, version: ENTITY_VERSION, kind,
    id: pattern.test(input.id ?? '') ? input.id : newId(kindOf(kind).idPrefix),
    name: values.name, category: values.category,
    presetId: typeof input.presetId === 'string' ? input.presetId.slice(0, 64) : null,
    presetName: typeof input.presetName === 'string' ? input.presetName.slice(0, 80) : '',
    sheet: { kind, fields: sheet.fields, layout: sheet.layout },
    values, shown, refs,
    ...(input.known === true ? { known: true } : {}),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

/** What Hide all / Reveal all can set every field to. */
export const ALL_FIELDS_VISIBILITY = ['revealed', 'hidden'];

/**
 * An entry with every field of its sheet set to one visibility ('revealed' or 'hidden'):
 * a tab's Hide all / Reveal all. Each field's Obscure style and custom text, and the
 * entry's Shown text, stay as they were, so the GM can switch a field back later.
 */
export function withAllFields(entity, visibility) {
  if (!ALL_FIELDS_VISIBILITY.includes(visibility)) throw new PresetError([`Can't set every field to "${visibility}"`]);
  const sheet = structuredClone(entity.sheet);
  for (const f of Object.values(sheet.fields ?? {})) f.visibility = visibility;
  return { ...entity, sheet };
}

/** How many of an entry's fields aren't already `visibility` (0: Hide all / Reveal all changes nothing). */
export const fieldsNotAt = (entity, visibility) => Object.values(entity.sheet?.fields ?? {}).filter((f) => f.visibility !== visibility).length;

/** Asset ids an entity uses (for clean-up and export later). */
export function assetsOf(entity) {
  return fieldsInOrder(entity.sheet).flatMap((f) => {
    const v = entity.values[f.id];
    if (f.type === 'image' && v) return [v];
    if (f.type === 'gallery' && Array.isArray(v)) return v.map((x) => x.image);
    return [];
  });
}
