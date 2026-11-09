// Screamsheets: in-world news, made with the Screamsheet Generator (or by hand) and kept
// under World › Screamsheets. Pure data + functions, shared by the browser and the server,
// which checks every save with normalizeScreamsheet().
//
// A screamsheet is an issue: a page of the news, like the rulebook's Night City Today feed.
// Its lead article sits at the top level (so a one-article screamsheet is simply one with
// no items), and the rest of the page is `items`: more articles, and ads.
//
// Screamsheet {
//   id: ss_xxxxxxxx,
//   outlet, dateline          the masthead: which paper, and its date line
//   section                   the section tab lit on the masthead (SECTIONS), or '' for none
//   layout                    feed | broadsheet | crt | plain (how it looks, everywhere)
//   revealed                  players can see it (and it can be pushed)
//   -- the lead article --
//   headline, body, byline    the finished text (paragraphs split by blank lines)
//   image, caption, imagePos  an optional picture, before or after the text (PICTURE_SPOTS)
//   links                     [{ text, ref? }]  "Link: …" lines; ref = an entry it points at
//   notes                     [{ label, text }] bold-labelled extras: "Disclaimer: …", "Correction: …"
//   parts                     what players get of each part, when not all of it: { headline|outlet|dateline|byline|body:
//                             { visibility: rumored|hidden, style: redacted|static|encrypted|text, text } }
//   selection, values, edited the generator's picks and fill-ins, so it can be reopened and rerolled
//   mentions                  ids of entries named in the fill-ins (GM only)
//   -- the rest of the page --
//   items: [
//     { id: it_xxxx, type: 'article', headline, body, byline, image, caption, imagePos, links, notes, parts, selection, values, edited, mentions, hidden },
//     { id: it_xxxx, type: 'ad', image, tagline, links, hidden },
//   ]                         hidden: kept off the players' copy altogether
//   createdAt, updatedAt
// }

import { ENTITY_ID, ASSET_ID } from '../forge/preset-model.js';

export const SS_ID = /^ss_[0-9a-f]{8}$/;
const ITEM_ID = /^it_[0-9a-f]{6}$/;
const MAX_ITEMS = 16;
const MAX_LINKS = 6;
const MAX_NOTES = 4;

/** The parts of an article the GM can obscure or hide, in reading order (outlet and date line: the lead's only). */
export const PARTS = [
  { id: 'outlet', label: 'Outlet' },
  { id: 'dateline', label: 'Date line' },
  { id: 'headline', label: 'Headline' },
  { id: 'byline', label: 'Byline' },
  { id: 'body', label: 'Article' },
  { id: 'image', label: 'Picture' },
];
const ITEM_PARTS = ['headline', 'byline', 'body', 'image'];
/** Where an article's picture goes: above its text, or below it. */
export const PICTURE_SPOTS = [
  { id: 'before', label: 'Before the text' },
  { id: 'after', label: 'After the text' },
];
/** An article's picture: { image, caption, imagePos } (no picture: image null). */
const cleanPicture = (raw) => ({
  image: ASSET_ID.test(raw?.image ?? '') ? raw.image : null,
  caption: text(raw?.caption, 160),
  imagePos: PICTURE_SPOTS.some((p) => p.id === raw?.imagePos) ? raw.imagePos : 'before',
});
const PART_VISIBILITY = ['rumored', 'hidden'];
const PART_STYLES = ['redacted', 'static', 'encrypted', 'text'];

/** The section tabs on a news feed's masthead, as the rulebook's Night City Today has them. */
export const SECTIONS = [
  { id: 'gossip', label: 'Gossip' },
  { id: 'opinion', label: 'Opinion' },
  { id: 'weather', label: 'Weather' },
  { id: 'tech', label: 'Tech' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'local', label: 'Local' },
  { id: 'business', label: 'Business' },
  { id: 'world', label: 'World' },
];

export const LAYOUTS = [
  { id: 'feed', label: 'News feed (a screen, with section tabs)' },
  { id: 'broadsheet', label: 'Broadsheet (formal newspaper)' },
  { id: 'crt', label: 'Terminal (CRT screen feed)' },
  { id: 'plain', label: 'Plain (follows the theme)' },
];

export class ScreamsheetError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const prose = (v, max) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const index = (v) => (Number.isInteger(v) && v >= 0 && v < 12 ? v : 0);
const hex = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
export const newItemId = () => `it_${hex(3)}`;

/** Tidy parts: only obscured or hidden ones are kept (everything else is revealed). */
function cleanParts(input, allowed = PARTS.map((p) => p.id)) {
  const out = {};
  for (const id of allowed) {
    const p = input?.[id];
    if (!p || !PART_VISIBILITY.includes(p.visibility)) continue;
    out[id] = p.visibility === 'hidden'
      ? { visibility: 'hidden' }
      : { visibility: 'rumored', style: PART_STYLES.includes(p.style) ? p.style : 'redacted', text: text(p.text, 200) };
  }
  return out;
}

const cleanLinks = (list) => (Array.isArray(list) ? list : [])
  .map((l) => (typeof l === 'string' ? { text: l } : l))
  .map((l) => ({ text: text(l?.text, 120), ...(ENTITY_ID.test(l?.ref ?? '') ? { ref: l.ref } : {}) }))
  .filter((l) => l.text)
  .slice(0, MAX_LINKS);

const cleanNotes = (list) => (Array.isArray(list) ? list : [])
  .map((n) => ({ label: text(n?.label, 30) || 'Note', text: prose(n?.text, 1200) }))
  .filter((n) => n.text)
  .slice(0, MAX_NOTES);

function cleanGenerator(input) {
  const s = input.selection;
  const values = {};
  for (const [k, v] of Object.entries(input.values && typeof input.values === 'object' ? input.values : {}).slice(0, 60)) {
    if (typeof k === 'string' && k.length <= 80) values[k] = text(v, 200);
  }
  return {
    selection: s && typeof s === 'object' && typeof s.typeId === 'string'
      ? { typeId: text(s.typeId, 64), intro: index(s.intro), body: index(s.body), conclusion: index(s.conclusion), headline: text(s.headline, 16) }
      : null,
    values,
    edited: input.edited === true,
    mentions: [...new Set((Array.isArray(input.mentions) ? input.mentions : []).filter((id) => typeof id === 'string' && ENTITY_ID.test(id)))].slice(0, 40),
  };
}

function cleanItem(raw, problems, n) {
  const id = ITEM_ID.test(raw?.id ?? '') ? raw.id : newItemId();
  if (raw?.type === 'ad') {
    const ad = { id, type: 'ad', image: ASSET_ID.test(raw.image ?? '') ? raw.image : null, tagline: text(raw.tagline, 200), links: cleanLinks(raw.links), hidden: raw.hidden === true };
    if (!ad.image && !ad.tagline) problems.push(`Ad ${n} needs a picture or a tagline`);
    return ad;
  }
  const headline = text(raw?.headline, 200);
  if (!headline) problems.push(`Article ${n} needs a headline`);
  return {
    id, type: 'article', headline, body: prose(raw?.body, 20000), byline: text(raw?.byline, 80), ...cleanPicture(raw),
    links: cleanLinks(raw?.links), notes: cleanNotes(raw?.notes), parts: cleanParts(raw?.parts, ITEM_PARTS),
    ...cleanGenerator(raw ?? {}), hidden: raw?.hidden === true,
  };
}

/** Check and tidy a screamsheet. Throws ScreamsheetError for what can't be repaired. */
export function normalizeScreamsheet(input) {
  if (!input || typeof input !== 'object') throw new ScreamsheetError(['A screamsheet must be an object']);
  const problems = [];
  const headline = text(input.headline, 200);
  if (!headline) problems.push('A screamsheet needs a headline');
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, MAX_ITEMS).map((it, i) => cleanItem(it, problems, i + 2));
  const ids = new Set();
  for (const it of items) {
    while (ids.has(it.id)) it.id = newItemId();
    ids.add(it.id);
  }
  if (problems.length) throw new ScreamsheetError(problems);
  const now = new Date().toISOString();
  return {
    id: SS_ID.test(input.id ?? '') ? input.id : null,
    headline,
    body: prose(input.body, 20000),
    outlet: text(input.outlet, 80),
    byline: text(input.byline, 80),
    ...cleanPicture(input),
    dateline: text(input.dateline, 80),
    section: SECTIONS.some((x) => x.id === input.section) ? input.section : '',
    layout: LAYOUTS.some((l) => l.id === input.layout) ? input.layout : 'broadsheet',
    revealed: input.revealed === true,
    links: cleanLinks(input.links),
    notes: cleanNotes(input.notes),
    parts: cleanParts(input.parts),
    ...cleanGenerator(input),
    items,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

/** Every article on the page, the lead first: [{ id: null (the lead) | it_…, headline, … }]. */
export const articlesOf = (sheet) => [{ ...sheet, id: null, type: 'article' }, ...(sheet.items ?? []).filter((it) => it.type === 'article')];

/** A piece of the players' copy: obscured parts carry only how they're obscured, hidden parts nothing. */
function printedArticle(a, allowed, known) {
  const copy = {
    headline: a.headline, body: a.body, byline: a.byline,
    image: a.image ?? null, caption: a.caption ?? '', imagePos: a.imagePos ?? 'before',
    links: (a.links ?? []).map((l) => ({ text: l.text, ...(l.ref && known.has(l.ref) ? { ref: l.ref } : {}) })),
    notes: (a.notes ?? []).map((n) => ({ label: n.label, text: n.text })),
    obscured: {}, hidden: [],
  };
  for (const [part, p] of Object.entries(a.parts ?? {})) {
    if (!allowed.includes(part)) continue;
    if (part === 'image') {
      if (!copy.image) continue; // nothing there to keep from them
      copy.image = null;
      copy.caption = '';
    } else copy[part] = '';
    if (p.visibility === 'hidden') copy.hidden.push(part);
    else copy.obscured[part] = { style: p.style ?? 'redacted', ...(p.style === 'text' ? { text: p.text ?? '' } : {}) };
  }
  return copy;
}

/**
 * The players' copy, as printed: no generator state, no mentions, no hidden pieces;
 * obscured parts carry only how they're obscured (obscured: { part: { style, text } })
 * and hidden parts nothing (hidden: [part]). Links keep the entry they point at only
 * when it's in `known` (ids the players know of; see the Codex).
 */
export function playerCopy(sheet, { known = new Set() } = {}) {
  const lead = printedArticle(sheet, PARTS.map((p) => p.id), known);
  const copy = { id: sheet.id, outlet: sheet.outlet, dateline: sheet.dateline, section: sheet.section ?? '', layout: sheet.layout, ...lead };
  for (const part of ['outlet', 'dateline']) if (sheet.parts?.[part]) copy[part] = '';
  copy.items = (sheet.items ?? []).filter((it) => !it.hidden).map((it) => (it.type === 'ad'
    ? { id: it.id, type: 'ad', image: it.image, tagline: it.tagline, links: printedArticle(it, [], known).links }
    : { id: it.id, type: 'article', ...printedArticle(it, ITEM_PARTS, known) }));
  return copy;
}
/** What players get: revealed screamsheets, as printed. */
export const forPlayers = (list) => list.filter((s) => s.revealed).map((s) => playerCopy(s));
/** A title for a screamsheet that gives nothing away: its headline only if players may read it. */
export const playerTitle = (sheet) => (sheet.parts?.headline ? 'Screamsheet' : sheet.headline);

/** Sort newest first. */
export const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

/** "Night City Today" → "NCT": the masthead's monogram. */
export const monogram = (outlet) => (String(outlet || 'Screamsheet').match(/[A-Za-z0-9]+/g) ?? ['S']).filter((w) => !/^(the|of|and|a)$/i.test(w)).slice(0, 4).map((w) => w[0].toUpperCase()).join('') || 'S';

/** "Link: …" text to links, one per line; a line naming an entry exactly links to it. */
export function parseLinks(textBlock, entries = []) {
  const byName = new Map(entries.map((e) => [String(e.name).trim().toLowerCase(), e.id]));
  return cleanLinks(String(textBlock ?? '').split('\n').map((line) => line.replace(/^\s*link:\s*/i, '').trim()).filter(Boolean)
    .map((t) => ({ text: t, ...(byName.has(t.toLowerCase()) ? { ref: byName.get(t.toLowerCase()) } : {}) })));
}
/** "Disclaimer: …" blocks to notes: each line starting "Label:" opens one; following lines continue it. */
export function parseNotes(textBlock) {
  const out = [];
  for (const line of String(textBlock ?? '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z '’-]{0,28}):\s*(.*)$/);
    if (m) out.push({ label: m[1].trim(), text: m[2] });
    else if (out.length && line.trim()) out.at(-1).text += `\n${line.trim()}`;
    else if (line.trim()) out.push({ label: 'Note', text: line.trim() });
  }
  return cleanNotes(out);
}
export const linksText = (links = []) => links.map((l) => l.text).join('\n');
export const notesText = (notes = []) => notes.map((n) => `${n.label}: ${n.text}`).join('\n');
