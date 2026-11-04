// The players' turn bar: a strip across the top of the player screen while
// combat is on. Cards run in turn order starting with whoever is acting, so
// the acting combatant is always leftmost. When the turn passes, everyone
// slides one place left and the card that just acted slips out at the left
// and rejoins at the right end (round-robin, like Baldur's Gate 3).
//
// The server only sends what players may see: no hidden or defeated foes, and
// coarse health for anyone who isn't a player character.

import { el } from './ui.js';

const HEALTH = {
  unhurt: { label: 'Unhurt', value: 1, tone: 'success' },
  wounded: { label: 'Wounded', value: 0.7, tone: 'success' },
  bloodied: { label: 'Bloodied', value: 0.4, tone: 'warning' },
  critical: { label: 'Critical', value: 0.15, tone: 'danger' },
  down: { label: 'Down', value: 0, tone: 'danger' },
};
const SLIDE_MS = 520;
const EASE = 'cubic-bezier(0.3, 0.7, 0.2, 1)';

const initials = (name) => name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '·';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.effects === 'off';

export function initiativeBar(ctx) {
  const round = el('div', { class: 'itb__round' });
  const track = el('ol', { class: 'itb__track' });
  const node = el('section', { class: 'itb', hidden: true, 'aria-label': 'Turn order', 'aria-live': 'polite' }, round, track);
  let leaving = null;

  function card(c, current) {
    const health = c.pc
      ? { label: `${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp}` : ''}`, value: c.maxHp ? c.hp / c.maxHp : 0 }
      : HEALTH[c.health] ?? HEALTH.unhurt;
    const tone = health.tone ?? (health.value > 0.5 ? 'success' : health.value > 0.25 ? 'warning' : 'danger');
    const shown = c.conditions.slice(0, current ? 4 : 2);
    const more = c.conditions.length - shown.length;
    return el('li', { class: `itb__card itb__card--${c.side} ${current ? 'is-current' : ''}`, 'data-id': c.id, 'aria-current': current ? 'step' : null },
      c.image
        ? el('img', { class: 'itb__portrait', src: ctx.api.imageUrl(c.image), alt: '' })
        : el('span', { class: 'itb__portrait itb__portrait--sigil', 'aria-hidden': 'true' }, initials(c.name)),
      el('div', { class: 'itb__info' },
        current ? el('span', { class: 'itb__turn tp-label' }, 'Taking their turn') : null,
        // The clone number never truncates: it's how players tell Raider #2 from #3.
        el('span', { class: 'itb__name', title: c.no ? `${c.name} #${c.no}` : c.name }, el('span', {}, c.name), c.no ? el('b', { class: 'itb__no' }, `#${c.no}`) : null),
        el('span', { class: 'itb__hp' },
          el('span', { class: `tp-meter tp-meter--${tone}`, style: `--value:${health.value}` }),
          el('span', { class: 'itb__hp-label tp-mono' }, health.label),
          c.pc && c.armor != null ? el('span', { class: 'itb__armor tp-mono', title: ctx.engine.t('armor', 'Armor') }, `◆${c.armor}`) : null),
        c.pc && current && c.slots?.length
          ? el('span', { class: 'itb__slots' }, c.slots.map((p) =>
              el('span', { class: 'itb__pool', title: `${p.label}: ${p.max - p.used} of ${p.max} left` }, el('span', { class: 'tp-dim' }, p.label),
                el('span', { class: 'itb__pips' }, Array.from({ length: p.max }, (_, k) => el('i', { class: k < p.max - p.used ? 'is-full' : '' }))))))
          : null,
        shown.length
          ? el('span', { class: 'itb__conds' },
              shown.map((x) => el('span', { class: 'itb__cond', title: x.rounds ? `${x.name} (${x.rounds} round${x.rounds === 1 ? '' : 's'} left)` : x.name }, x.name, x.rounds ? el('b', {}, x.rounds) : null)),
              more > 0 ? el('span', { class: 'itb__cond' }, `+${more}`) : null)
          : null));
  }

  function update(view) {
    clearTimeout(leaving);
    if (!view?.active) {
      const hide = () => ((node.hidden = true), track.replaceChildren());
      if (node.hidden || still()) return hide();
      // A timer, not the animation's end: animations stall in background windows.
      node.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-100%)' }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
      leaving = setTimeout(() => {
        node.getAnimations().forEach((a) => a.cancel());
        hide();
      }, 400);
      return;
    }
    node.getAnimations().forEach((a) => a.cancel()); // back in combat before the exit finished

    // Rotate so whoever is acting comes first.
    const at = Math.max(0, view.order.findIndex((c) => c.id === view.current));
    const order = [...view.order.slice(at), ...view.order.slice(0, at)];

    // FLIP: remember where each card was, rebuild, then animate from there.
    const before = new Map([...track.children].map((li) => [li.dataset.id, li.getBoundingClientRect()]));
    // The round-robin wrap: on a new turn the old leftmost card goes to the far right
    // (or, stepping back, the rightmost comes round to the front).
    const prevIds = [...before.keys()];
    const wrapId = prevIds.length > 1 && order.length > 1
      ? order.at(-1).id === prevIds[0] && order[0].id !== prevIds[0] ? prevIds[0]
        : order[0].id === prevIds.at(-1) && order[0].id !== prevIds[0] ? prevIds.at(-1) : null
      : null;
    const appearing = node.hidden;
    node.hidden = false;
    round.replaceChildren(el('span', { class: 'tp-label' }, 'Round'), el('strong', { class: 'itb__round-n tp-mono' }, view.round));
    track.replaceChildren(...order.map((c) => card(c, c.id === view.current)));

    if (still()) return;
    if (appearing) {
      node.animate([{ opacity: 0, transform: 'translateY(-100%)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: EASE });
      [...track.children].forEach((li, i) =>
        li.animate([{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 120 + i * 60, easing: EASE, fill: 'backwards' }));
      return;
    }
    for (const li of track.children) {
      const was = before.get(li.dataset.id);
      const now = li.getBoundingClientRect();
      if (!was) {
        li.animate([{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE });
        continue;
      }
      const dx = was.left - now.left;
      if (Math.abs(dx) < 1) continue;
      // The wrapping card leaves by the near edge and comes back in from the far
      // one, instead of sliding back across everyone.
      if (li.dataset.id === wrapId) {
        const out = dx < 0 ? -1 : 1; // moved right → it left at the left edge
        li.animate([
          { transform: `translateX(${dx}px)`, opacity: 1 },
          { transform: `translateX(${dx + out * now.width * 0.8}px)`, opacity: 0, offset: 0.4 },
          { transform: `translateX(${-out * now.width * 0.8}px)`, opacity: 0, offset: 0.41 },
          { transform: 'none', opacity: 1 },
        ], { duration: SLIDE_MS + 180, easing: EASE });
      } else {
        li.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE });
      }
    }
  }

  return { node, update };
}
