// Structure helpers over the all-entities name index: containment
// (breadcrumbs, children, the Atlas) and "what links here".

export const refTypesOf = (field) => (field.refType == null ? null : [].concat(field.refType));

const MAX_DEPTH = 64;

/** Containment chain from the outermost container down to (not including) the entity. */
export function ancestors(entity, names) {
  const chain = [];
  let cursor = entity.data?.parent ? names.get(entity.data.parent) : null;
  while (cursor && chain.length < MAX_DEPTH) {
    chain.unshift(cursor);
    cursor = cursor.data?.parent ? names.get(cursor.data.parent) : null;
  }
  return chain;
}

/** Direct children (entities whose `parent` is this one), grouped by type in type order. */
export function children(id, names, types) {
  const list = [...names.values()].filter((e) => !e.deleted && e.data?.parent === id);
  return groupByType(list, types);
}

/**
 * Every other entity that points at `id` through a ref/refs field other than
 * `parent` — members, followers, residents, owners… Relationships are listed
 * separately and excluded here. Returns [{ type, field, entities }].
 */
export function backlinks(id, names, types) {
  const byType = new Map(types.map((t) => [t.id, t]));
  const groups = new Map();
  for (const e of names.values()) {
    if (e.deleted || e.type === 'relation' || e.id === id) continue;
    const type = byType.get(e.type);
    if (!type) continue;
    for (const field of type.fields) {
      if (field.role === 'parent') continue;
      const value = e.data?.[field.key];
      const hit = field.type === 'ref' ? value === id : field.type === 'refs' && Array.isArray(value) && value.includes(id);
      if (!hit) continue;
      const key = `${type.id}:${field.key}`;
      if (!groups.has(key)) groups.set(key, { type, field, entities: [] });
      groups.get(key).entities.push(e);
    }
  }
  const order = new Map(types.map((t, i) => [t.id, i]));
  return [...groups.values()]
    .map((g) => ({ ...g, entities: g.entities.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => order.get(a.type.id) - order.get(b.type.id) || a.field.label.localeCompare(b.field.label));
}

export function groupByType(list, types) {
  const out = [];
  for (const type of types) {
    const entities = list.filter((e) => e.type === type.id).sort((a, b) => a.name.localeCompare(b.name));
    if (entities.length) out.push({ type, entities });
  }
  return out;
}

/** Types whose instances form the geographic Atlas, outermost first. */
export const ATLAS_TYPES = ['system', 'world', 'nation', 'region', 'community', 'place'];

/** Roots of the Atlas: atlas entities whose parent is missing or not itself in the atlas. */
export function atlasRoots(names) {
  const atlas = [...names.values()].filter((e) => !e.deleted && ATLAS_TYPES.includes(e.type));
  const inAtlas = new Set(atlas.map((e) => e.id));
  return atlas
    .filter((e) => !e.data?.parent || !inAtlas.has(e.data.parent))
    .sort((a, b) => ATLAS_TYPES.indexOf(a.type) - ATLAS_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
}

export function atlasChildren(id, names) {
  return [...names.values()]
    .filter((e) => !e.deleted && ATLAS_TYPES.includes(e.type) && e.data?.parent === id)
    .sort((a, b) => ATLAS_TYPES.indexOf(a.type) - ATLAS_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
}

/** Era containing game time t, from an earliest-first era list. */
export function eraAt(eras, t) {
  return eras.filter((e) => e.data.start <= t && (e.data.end == null || t < e.data.end)).at(-1) ?? null;
}
