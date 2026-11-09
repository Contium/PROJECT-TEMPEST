// Sessions (game nights) and handouts: the Sessions section's data. Pure data + functions,
// shared by the browser and the server, which checks every save with normalizeSession() /
// normalizeHandout() and builds the players' copies here (playerRecap, playerHandout).
//
// Session {
//   id: sess_xxxxxxxx
//   number            1, 2, 3… (the order they're listed in)
//   title             "The Halcyon Extraction"
//   date              when it's played, 'YYYY-MM-DD' (real-world), or null
//   status            planned | played
//   plan              [{ id: bxxxxxx, text, done }]   the prep checklist: scenes, beats, things to bring
//   cast              [entity ids]                    the people, places and things it features (GM quick links)
//   notes             GM only: what happened, what to remember
//   recap             for the players: "Previously…"
//   recapShared       the recap is in the players' Codex (pushing it shares it too)
//   createdAt, updatedAt
// }
//
// Handout {
//   id: hand_xxxxxxxx
//   title             what it's called ("Wakako's note"); players see it too
//   style             letter | note | document | datapad | picture  (how it looks, everywhere)
//   image, caption    an optional picture (above the text)
//   text              the words on it (paragraphs split by blank lines)
//   from              who signed or sent it ("— W.")
//   obscure           null, or redacted | static | encrypted: players see that the text is
//                     there, not what it says (until the GM clears it: the code is cracked)
//   revealed          in the players' Codex (pushing it reveals it too)
//   session           the session it belongs to (sess_…), or null
//   createdAt, updatedAt
// }

import { ENTITY_ID, ASSET_ID } from '../forge/preset-model.js';

export const SESSION_ID = /^sess_[0-9a-f]{8}$/;
export const HANDOUT_ID = /^hand_[0-9a-f]{8}$/;
const BEAT_ID = /^b[0-9a-f]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BEATS = 60;
const MAX_CAST = 40;

export const STATUSES = [
  { id: 'planned', label: 'Planned' },
  { id: 'played', label: 'Played' },
];

/** How a handout looks: a prop the players hold, whatever the theme. */
export const STYLES = [
  { id: 'letter', label: 'Letter', hint: 'Paper and ink, signed at the bottom' },
  { id: 'note', label: 'Scrawled note', hint: 'A hurried note, handwritten' },
  { id: 'document', label: 'Typed document', hint: 'A typed report, dossier or contract' },
  { id: 'datapad', label: 'Datapad message', hint: 'A message on a screen' },
  { id: 'picture', label: 'Picture', hint: 'A photo, map or drawing, with a caption' },
];

/** How the players see a handout's text while it's obscured (the same styles as sheet fields). */
export const OBSCURE_STYLES = [
  { id: 'redacted', label: 'Redacted' },
  { id: 'static', label: 'Static' },
  { id: 'encrypted', label: 'Encrypted' },
];

export class SessionError extends Error {
  constructor(message, problems = [message]) {
    super(message);
    this.problems = problems;
  }
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const stamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined);
const realDate = (v) => (typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const newHex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
export const newBeatId = () => `b${newHex(6)}`;
/** Entity ids a session can feature: characters, stories, items, factions… (not sessions or handouts). */
const isEntity = (id) => typeof id === 'string' && ENTITY_ID.test(id) && !SESSION_ID.test(id) && !HANDOUT_ID.test(id);

/** Check a session. Throws SessionError. */
export function normalizeSession(input) {
  if (!input || typeof input !== 'object') throw new SessionError('A session must be an object');
  const number = Math.round(Number(input.number));
  const seen = new Set();
  const plan = (Array.isArray(input.plan) ? input.plan : [])
    .map((b) => ({ id: BEAT_ID.test(b?.id ?? '') ? b.id : newBeatId(), text: text(b?.text, 300), done: b?.done === true }))
    .filter((b) => b.text && !seen.has(b.id) && seen.add(b.id));
  if (plan.length > MAX_BEATS) throw new SessionError(`A session's plan holds at most ${MAX_BEATS} lines`);
  const cast = [...new Set((Array.isArray(input.cast) ? input.cast : []).filter(isEntity))];
  if (cast.length > MAX_CAST) throw new SessionError(`A session features at most ${MAX_CAST} entries`);
  return {
    ...(SESSION_ID.test(input.id ?? '') ? { id: input.id } : {}),
    number: Number.isFinite(number) ? Math.min(9999, Math.max(1, number)) : 1,
    title: text(input.title, 120),
    date: realDate(input.date),
    status: STATUSES.some((s) => s.id === input.status) ? input.status : 'planned',
    plan,
    cast,
    notes: text(input.notes, 20000),
    recap: text(input.recap, 8000),
    recapShared: input.recapShared === true,
    ...(stamp(input.createdAt) ? { createdAt: input.createdAt } : {}),
    ...(stamp(input.updatedAt) ? { updatedAt: input.updatedAt } : {}),
  };
}

/** Check a handout. Throws SessionError. */
export function normalizeHandout(input) {
  if (!input || typeof input !== 'object') throw new SessionError('A handout must be an object');
  const style = STYLES.some((s) => s.id === input.style) ? input.style : 'letter';
  return {
    ...(HANDOUT_ID.test(input.id ?? '') ? { id: input.id } : {}),
    title: text(input.title, 120) || 'Untitled handout',
    style,
    image: ASSET_ID.test(input.image ?? '') ? input.image : null,
    caption: text(input.caption, 160),
    text: text(input.text, 8000),
    from: text(input.from, 120),
    obscure: OBSCURE_STYLES.some((s) => s.id === input.obscure) ? input.obscure : null,
    revealed: input.revealed === true,
    session: SESSION_ID.test(input.session ?? '') ? input.session : null,
    ...(stamp(input.createdAt) ? { createdAt: input.createdAt } : {}),
    ...(stamp(input.updatedAt) ? { updatedAt: input.updatedAt } : {}),
  };
}

/** "Session 12: The Halcyon Extraction", or "Session 12". */
export const sessionTitle = (s) => `Session ${s.number}${s.title ? `: ${s.title}` : ''}`;

/** A real-world date as people say it ("7 Nov 2026"), or ''. */
export function dayOf(date) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Paragraphs of a text: split by blank lines. */
export const paragraphs = (t) => String(t ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/** The players' copy of a session: its number, title, date and recap. Never the plan, cast or notes. */
export const playerRecap = (s) => ({ id: s.id, number: s.number, title: s.title, date: s.date, recap: s.recap });

/**
 * The players' copy of a handout. Obscured text never leaves the server: players get its
 * length (so the redaction looks the right size) and the style, not the words.
 */
export function playerHandout(h) {
  return {
    id: h.id,
    title: h.title,
    style: h.style,
    image: h.image,
    caption: h.caption,
    text: h.obscure ? '' : h.text,
    from: h.from,
    obscure: h.obscure,
    ...(h.obscure ? { length: h.text.length } : {}),
  };
}

/** Sessions in order, newest first. */
export const byNumber = (list) => [...list].sort((a, b) => b.number - a.number || String(b.createdAt).localeCompare(String(a.createdAt)));

// For the server's stores (server/pois.js): the players' lists.
export const sessionsForPlayers = (list) => byNumber(list.filter((s) => s.recapShared && s.recap)).map(playerRecap);
export const handoutsForPlayers = (list) => list.filter((h) => h.revealed).map(playerHandout);
