// Screamsheet generator engine (pure functions; no DOM), from v0.
//
// A pack (see scripts/import_screamsheet.py) holds article types, each with six
// intros, bodies and conclusions, plus headlines keyed by code. Every
// conclusion lists the headline codes that suit it ("any" = all of them).
// Bracketed text such as [Name 1] or [Location (Neighborhood)] is a fill-in field.

const PARTS = ['intro', 'body', 'conclusion'];
const TABLE = { intro: 'intros', body: 'bodies', conclusion: 'conclusions' };
const FIELD = /\[([^[\]]+)\]/g;

/** A fair 1..sides roll from the platform CSPRNG. */
export function roll(sides = 6) {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return (buf[0] % sides) + 1;
}

export const partText = (type, part, index) => {
  const row = type[TABLE[part]][index];
  return typeof row === 'string' ? row : row.text;
};

export function typeForRoll(pack, value) {
  return pack.articleTypes.find((t) => t.rolls.includes(value)) ?? pack.articleTypes[0];
}

/** Headline codes suggested by the chosen conclusion. */
export function headlineOptions(type, conclusionIndex) {
  const codes = type.conclusions[conclusionIndex]?.headlines;
  return codes === 'any' || !codes?.length ? Object.keys(type.headlines) : codes.filter((c) => c in type.headlines);
}

/**
 * Roll everything not fixed in `keep` ({ typeId?, intro?, body?, conclusion?, headline? };
 * indexes are 0-5). Returns a selection plus the dice shown to the GM.
 */
export function generate(pack, keep = {}, die = roll) {
  const dice = {};
  let type = pack.articleTypes.find((t) => t.id === keep.typeId);
  if (!type) {
    dice.type = die(6);
    type = typeForRoll(pack, dice.type);
  }
  const selection = { typeId: type.id };
  for (const part of PARTS) {
    if (Number.isInteger(keep[part])) selection[part] = keep[part];
    else selection[part] = (dice[part] = die(type[TABLE[part]].length)) - 1;
  }
  const options = headlineOptions(type, selection.conclusion);
  if (keep.headline && options.includes(keep.headline)) selection.headline = keep.headline;
  else selection.headline = options[(dice.headline = die(options.length)) - 1];
  return { selection, dice };
}

/** Raw (unfilled) headline and paragraphs for a selection; null if the pack doesn't have it. */
export function compose(pack, selection) {
  const type = pack.articleTypes.find((t) => t.id === selection?.typeId);
  if (!type) return null;
  return {
    headline: type.headlines[selection.headline] ?? '',
    paragraphs: PARTS.flatMap((part) => partText(type, part, selection[part]).split(/\n{2,}/)),
  };
}

/** Field labels match regardless of case, spacing or apostrophe style. */
export const fieldKey = (label) => label.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Unique fill-in fields in order of first appearance: [{ key, label }]. */
export function fieldsIn(...texts) {
  const seen = new Map();
  for (const text of texts) {
    for (const m of String(text).matchAll(FIELD)) {
      const key = fieldKey(m[1]);
      if (!seen.has(key)) seen.set(key, { key, label: m[1].trim() });
    }
  }
  return [...seen.values()];
}

/** Replace each [Field] that has a value; unfilled fields stay bracketed. */
export function fill(text, values) {
  return String(text).replace(FIELD, (whole, label) => {
    const value = values[fieldKey(label)];
    return value != null && String(value).trim() ? String(value).trim() : whole;
  });
}

// Word lists for blanks that ask for a description rather than a specific name.
const CHOICES = [
  [/location or vehicle/, ['armored van', 'AV', 'convoy truck', 'warehouse', 'clinic', 'safehouse']],
  [/location type/, ['warehouse', 'safehouse', 'clinic', 'nightclub', 'checkpoint', 'storefront', 'garage']],
  [/item type/, ['weapons', 'cyberware', 'military drones', 'synth-drugs', 'data shards', 'medical supplies']],
  [/media type/, ['album', 'braindance', 'music video', 'holo-series', 'single', 'exposé']],
  [/event type|^event$/, ['concert', 'gala', 'premiere', 'charity auction', 'street race', 'product launch']],
  [/disaster type/, ['fire', 'blackout', 'riot', 'gas leak', 'flood']],
  [/relationship or job title/, ['business partner', 'bodyguard', 'lead engineer', 'personal fixer', 'sibling', 'spokesperson']],
  [/relationship type/, ['business partners', 'lovers', 'bandmates', 'best friends', 'siblings']],
  [/job type|job title/, ['fixer', 'ripperdoc', 'netrunner', 'solo', 'media', 'corporate exec', 'engineer']],
  [/^incident$/, ['shootout', 'blackout', 'explosion', 'riot', 'data breach']],
  [/day of the week/, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']],
  [/time of day/, ['morning', 'afternoon', 'evening', 'night', 'just before dawn', 'around midnight']],
  [/^number$/, ['two', 'three', 'four', 'five', 'six', 'eight']],
];

/**
 * What a field asks for, so the generator can suggest names from the project.
 *   { kind: 'people' }            a person: the project's characters
 *   { kind: 'places', district }  a place: Night City's districts and the project's points of interest
 *   { kind: 'members', group }    people belonging to another blank's group ("[members of Group 2]")
 *   { kind: 'choice', options }   a descriptive word ("[Location Type]" → warehouse)
 *   { kind: 'text' }              anything ([Adjective], [Group 1]…)
 */
export function fieldKind(label) {
  const l = fieldKey(label);
  if (/member/.test(l)) {
    const group = l.match(/group \d/)?.[0];
    return group ? { kind: 'members', group } : { kind: 'text' };
  }
  const choice = CHOICES.find(([re]) => re.test(l));
  if (choice) return { kind: 'choice', options: choice[1] };
  if (/^(name|critic|fan name|reporter)/.test(l) || /performer/.test(l)) return { kind: 'people' };
  if (/location \(neighbou?rhood\)/.test(l)) return { kind: 'places', district: true };
  if (/location|venue/.test(l)) return { kind: 'places', district: false };
  return { kind: 'text' };
}

/** Suggestions for a "members of Group N" blank, built from that group's value. */
export function memberSuggestions(groupName) {
  const g = String(groupName ?? '').trim();
  return g ? [`${g} members`, `${g} soldiers`, `${g} agents`, `${g} gangers`] : [];
}
