// The attack scene: when the GM records an attack in the Initiative Tracker, the
// player screen's body shows attacker and target side by side for 12 seconds.
// The attacker lunges, a strike crosses to the target, the target reels (or
// dodges a miss), the damage pops, its health bar drains, and the scene fades
// back to the usual screen.
//
// The timeline is CSS (app.css, .atk*): this module builds the scene and sets
// the numbers it animates between (--from / --to on the health bar). Windows
// opened mid-attack join late with the scene already played out.

import { el } from './ui.js';

export const SCENE_MS = 12000;
const LEAVE_MS = 700;
const BANDS = { unhurt: 'Unhurt', wounded: 'Wounded', bloodied: 'Bloodied', critical: 'Critical', down: 'Down' };

const initials = (name) => name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '·';

export function attackScene(ctx) {
  const node = el('div', { class: 'atk', hidden: true, role: 'status', 'aria-live': 'assertive' });
  let shown = null;
  let timers = [];

  const later = (fn, ms) => timers.push(setTimeout(fn, Math.max(0, ms)));
  const hide = () => {
    timers.forEach(clearTimeout);
    timers = [];
    node.hidden = true;
    node.replaceChildren();
  };

  function portrait(who) {
    if (who.unknown) return el('div', { class: 'atk__portrait atk__portrait--sigil' }, '?');
    return who.image
      ? el('img', { class: 'atk__portrait', src: ctx.api.imageUrl(who.image), alt: '' })
      : el('div', { class: 'atk__portrait atk__portrait--sigil', 'aria-hidden': 'true' }, initials(who.name));
  }

  const nameplate = (who) => el('p', { class: 'atk__name' }, el('span', {}, who.name), who.no ? el('b', { class: 'atk__no' }, `#${who.no}`) : null);

  function healthLabel(h) {
    if (h.band) return BANDS[h.band] ?? '';
    return `${h.hp} / ${h.maxHp}${h.tempHp ? ` +${h.tempHp}` : ''}`;
  }

  /** Show an attack (from the players' encounter view); repeats and stale ones are ignored. */
  function show(a) {
    if (!a || a.seq === shown) return;
    const first = shown === null;
    shown = a.seq;
    const age = Date.now() - a.at;
    // On first load only replay an attack that is still on screen elsewhere.
    if (age >= SCENE_MS - LEAVE_MS || (first && age < 0)) return;
    hide();

    const t = a.target;
    const late = age > 2500; // joined mid-scene: skip straight to the outcome
    const verdict = a.result === 'miss' ? 'Miss' : a.result === 'crit' ? 'Critical hit' : 'Hit';
    node.className = `atk atk--${a.result} ${a.down ? 'atk--down' : ''} ${late ? 'is-late' : ''}`;
    node.replaceChildren(
      el('div', { class: 'atk__stage' },
        el('figure', { class: `atk__card atk__card--attacker atk__card--${a.attacker.side}` },
          el('div', { class: 'atk__frame' }, portrait(a.attacker)),
          el('figcaption', {}, el('span', { class: 'tp-label' }, 'Attacker'), nameplate(a.attacker))),
        el('div', { class: 'atk__mid', 'aria-hidden': 'true' },
          el('span', { class: 'atk__strike' }),
          el('span', { class: 'atk__verdict' }, verdict)),
        el('figure', { class: `atk__card atk__card--target atk__card--${t.side}` },
          el('div', { class: 'atk__frame' },
            portrait(t),
            el('span', { class: 'atk__slash', 'aria-hidden': 'true' }),
            el('span', { class: 'atk__flash', 'aria-hidden': 'true' }),
            a.result !== 'miss' ? el('span', { class: 'atk__damage', 'aria-hidden': 'true' }, a.damage ? `−${a.damage}` : '0') : null,
            a.down ? el('span', { class: 'atk__stamp' }, t.pc ? 'Down' : 'Defeated') : null),
          el('figcaption', {},
            el('span', { class: 'tp-label' }, 'Target'),
            nameplate(t),
            el('div', { class: `atk__health atk__health--${t.after.ratio > 0.5 ? 'success' : t.after.ratio > 0.25 ? 'warning' : 'danger'}`, style: `--from:${t.before.ratio};--to:${t.after.ratio}` },
              el('span', { class: 'atk__bar' }, el('i', { class: 'atk__bar-lag' }), el('i', { class: 'atk__bar-fill' })),
              el('span', { class: 'atk__hp tp-mono' },
                el('span', { class: 'atk__hp-before' }, healthLabel(t.before)),
                el('span', { class: 'atk__hp-after' }, healthLabel(t.after))))))),
      el('p', { class: 'app-visually-hidden' },
        `${a.attacker.name}${a.attacker.no ? ` #${a.attacker.no}` : ''} attacks ${t.name}${t.no ? ` #${t.no}` : ''}: ${verdict.toLowerCase()}${a.damage ? `, ${a.damage} damage` : ''}${a.down ? `. ${t.name} is down` : ''}.`),
    );
    node.hidden = false;
    later(() => node.classList.add('is-leaving'), SCENE_MS - LEAVE_MS - age);
    later(hide, SCENE_MS - age);
  }

  return {
    node,
    show,
    /** Combat ended: clear the scene at once. */
    clear: hide,
  };
}
