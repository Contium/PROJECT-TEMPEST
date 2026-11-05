// Obscured contents, the same everywhere players meet them (sheets, screamsheets):
// they know something is there, not what.
//   redacted   black bars
//   static     TV noise
//   encrypted  scrambled cipher text that keeps shifting
//   text       the GM's own words ("Nobody knows his real name")

import { el } from '../ui.js';

const CIPHER = '0123456789ABCDEF#%&@$▓▒░/\\<>{}[]';
/** Cipher text that looks like a scrambled version of `length` characters (stable per seed). */
export function cipher(length, seed = 1) {
  let x = (seed * 2654435761) >>> 0 || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += i && i % 5 === 4 ? ' ' : CIPHER[x % CIPHER.length];
  }
  return out;
}
const seedOf = (s) => [...String(s ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * obscured(style, { as, lines, text, seed })
 *   as     'name' (big, one line) | 'category' (short) | anything else
 *   lines  how long the hidden contents look: bar widths in %, e.g. [92, 100, 64]
 *   text   the words for style 'text'
 *   seed   keeps encrypted text the same on every redraw (e.g. the field id)
 */
export function obscured(style = 'redacted', { as, lines = [60], text = '', seed = '' } = {}) {
  if (style === 'text') return el('p', { class: 'sheet__rumor-text' }, text || '???');
  if (style === 'static') return el('span', { class: `sheet__static ${as === 'name' ? 'sheet__static--name' : ''}`, role: 'img', 'aria-label': 'Unknown' });
  if (style === 'encrypted') {
    const n = seedOf(seed);
    return el('span', { class: `sheet__encrypted ${as === 'name' ? 'sheet__encrypted--name' : ''}`, role: 'img', 'aria-label': 'Encrypted' },
      lines.map((w, i) => el('span', { class: 'sheet__cipher', style: `--d:${(i * 0.37) % 1.3}s` }, cipher(Math.max(4, Math.round(w / (as === 'name' ? 4 : 2.2))), n + i))));
  }
  return el('span', { class: `sheet__redacted ${as === 'name' ? 'sheet__redacted--name' : ''}`, role: 'img', 'aria-label': 'Redacted' },
    lines.map((w) => el('i', { style: `width:${w}%` })));
}
