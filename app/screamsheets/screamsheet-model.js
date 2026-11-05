// Screamsheets: in-world news articles made with the Screamsheet Generator and
// kept under World › Screamsheets. Pure data + functions, shared by the browser
// and the server, which checks every save with normalizeScreamsheet().
//
// Screamsheet {
//   id: ss_xxxxxxxx,
//   headline, body            the finished text (paragraphs split by blank lines)
//   outlet, byline, dateline  the masthead: which paper, who wrote it, its date line
//   layout                    broadsheet | crt | plain (how it looks, everywhere)
//   revealed                  players can see it (and it can be pushed)
//   parts                     what players get of each part, when not all of it: { headline|outlet|dateline|byline|body:
//                             { visibility: rumored|hidden, style: redacted|static|encrypted|text, text } }
//   selection                 the generator's picks { typeId, intro, body, conclusion, headline },
//   values                    and fill-ins { fieldKey: text }, so it can be reopened and rerolled
//   edited                    the text was changed by hand (rerolling would replace it)
//   mentions                  ids of entries named in the fill-ins (GM only)
//   createdAt, updatedAt
// }

import { ENTITY_ID } from '../forge/preset-model.js';

export const SS_ID = /^ss_[0-9a-f]{8}$/;
/** The parts of a screamsheet the GM can obscure or hide, in reading order. */
export const PARTS = [
  { id: 'outlet', label: 'Outlet' },
  { id: 'dateline', label: 'Date line' },
  { id: 'headline', label: 'Headline' },
  { id: 'byline', label: 'Byline' },
  { id: 'body', label: 'Article' },
];
const PART_VISIBILITY = ['rumored', 'hidden'];
const PART_STYLES = ['redacted', 'static', 'encrypted', 'text'];

/** Tidy parts: only obscured or hidden ones are kept (everything else is revealed). */
function cleanParts(input) {
  const out = {};
  for (const { id } of PARTS) {
    const p = input?.[id];
    if (!p || !PART_VISIBILITY.includes(p.visibility)) continue;
    out[id] = p.visibility === 'hidden'
      ? { visibility: 'hidden' }
      : { visibility: 'rumored', style: PART_STYLES.includes(p.style) ? p.style : 'redacted', text: text(p.text, 200) };
  }
  return out;
}
export const LAYOUTS = [
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
const index = (v) => (Number.isInteger(v) && v >= 0 && v < 12 ? v : 0);

/** Check and tidy a screamsheet. Throws ScreamsheetError for what can't be repaired. */
export function normalizeScreamsheet(input) {
  if (!input || typeof input !== 'object') throw new ScreamsheetError(['A screamsheet must be an object']);
  const headline = text(input.headline, 200);
  if (!headline) throw new ScreamsheetError(['A screamsheet needs a headline']);
  const s = input.selection;
  const values = {};
  for (const [k, v] of Object.entries(input.values && typeof input.values === 'object' ? input.values : {}).slice(0, 60)) {
    if (typeof k === 'string' && k.length <= 80) values[k] = text(v, 200);
  }
  const now = new Date().toISOString();
  return {
    id: SS_ID.test(input.id ?? '') ? input.id : null,
    headline,
    body: typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n').trim().slice(0, 20000) : '',
    outlet: text(input.outlet, 80),
    byline: text(input.byline, 80),
    dateline: text(input.dateline, 80),
    layout: LAYOUTS.some((l) => l.id === input.layout) ? input.layout : 'broadsheet',
    revealed: input.revealed === true,
    parts: cleanParts(input.parts),
    selection: s && typeof s === 'object' && typeof s.typeId === 'string'
      ? { typeId: text(s.typeId, 64), intro: index(s.intro), body: index(s.body), conclusion: index(s.conclusion), headline: text(s.headline, 16) }
      : null,
    values,
    edited: input.edited === true,
    mentions: [...new Set((Array.isArray(input.mentions) ? input.mentions : []).filter((id) => typeof id === 'string' && ENTITY_ID.test(id)))].slice(0, 40),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

/** What players get: revealed screamsheets, as printed (no generator state, no mentions). */
export const forPlayers = (list) => list.filter((s) => s.revealed).map(playerCopy);
/**
 * The players' copy, as printed: obscured parts carry only how they're obscured
 * (obscured: { part: { style, text } }) and hidden parts nothing (hidden: [part]).
 */
export function playerCopy(sheet) {
  const copy = { id: sheet.id, headline: sheet.headline, body: sheet.body, outlet: sheet.outlet, byline: sheet.byline, dateline: sheet.dateline, layout: sheet.layout, obscured: {}, hidden: [] };
  for (const [part, p] of Object.entries(sheet.parts ?? {})) {
    if (!PARTS.some((x) => x.id === part)) continue;
    copy[part] = '';
    if (p.visibility === 'hidden') copy.hidden.push(part);
    else copy.obscured[part] = { style: p.style ?? 'redacted', ...(p.style === 'text' ? { text: p.text ?? '' } : {}) };
  }
  return copy;
}
/** A title for a screamsheet that gives nothing away: its headline only if players may read it. */
export const playerTitle = (sheet) => (sheet.parts?.headline ? 'Screamsheet' : sheet.headline);

/** Sort newest first. */
export const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
