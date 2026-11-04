// Initiative Tracker: the GM's combat screen. Who is in the fight and in what
// order, whose turn it is, and everyone's hit points, armor, ability slots and
// conditions. Starting combat puts the turn order on the player screen; ending
// it takes it away again. The Attack form deals damage and plays the attack on
// the player screen (app/attack-scene.js). Keys: N next turn, P previous turn.

import { el, frame, panelHead, toastError, emptyState, confirmDialog } from '../ui.js';

const SIDES = [['pc', 'PC'], ['ally', 'Ally'], ['neutral', 'Neutral'], ['enemy', 'Enemy']];
// Suggestions only (same list as world/encounter.js); any name works.
const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed',
  'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Exhaustion', 'Concentrating',
  'Blessed', 'Hasted', 'Burning', 'Bleeding',
];

const nameOf = (c) => (c.no ? `${c.name} #${c.no}` : c.name);
const initials = (name) => name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '·';
const slotsText = (c) => c.slots.map((p) => `${p.label} ${p.max}`).join(', ');

export async function mount(root, ctx) {
  let state = await ctx.api.encounter();
  let candidates = [];
  const page = el('div', { class: 'app-page it' });
  root.append(page);
  const t = (key, fallback) => ctx.engine.t(key, fallback);

  async function loadCandidates() {
    const all = [...(await ctx.names()).values()].filter((e) => !e.deleted && (e.type === 'individual' || e.type === 'combatant'));
    candidates = all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function act(action) {
    try {
      show(await ctx.api.encounterAct(action));
    } catch (err) {
      toastError(err);
    }
  }

  function show(next) {
    // Our own action already drew this state; the live event for it changes nothing.
    if (next.rev === state.rev && page.childElementCount) return;
    state = next;
    render();
  }

  // --- pieces ---------------------------------------------------------------------

  const btn = (label, onClick, { cls = '', title, disabled = false } = {}) =>
    el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${cls}`, title, 'aria-label': title, disabled, onClick }, label);

  /** A number box that saves on change. `nullable` lets it be cleared (initiative, armor). */
  function numField(c, key, value, { nullable = false, min, max, title, cls = '' } = {}) {
    return el('input', {
      class: `tp-input it-num ${cls}`, type: 'number', inputmode: 'numeric', value: value ?? '', min, max, title, 'aria-label': title,
      'data-key': `${c.id}:${key}`,
      onChange: (e) => {
        const raw = e.target.value.trim();
        if (raw === '' && !nullable) return render();
        act({ action: 'update', id: c.id, patch: { [key]: raw === '' ? null : Math.round(Number(raw)) } });
      },
    });
  }

  function portrait(c) {
    return c.image
      ? el('img', { class: 'it-portrait', src: ctx.api.imageUrl(c.image), alt: '' })
      : el('span', { class: 'it-portrait it-portrait--sigil', 'aria-hidden': 'true' }, initials(c.name));
  }

  function hpBlock(c) {
    const ratio = c.maxHp ? c.hp / c.maxHp : 0;
    const tone = ratio > 0.5 ? 'success' : ratio > 0.25 ? 'warning' : 'danger';
    return el('div', { class: 'it-hp' },
      el('div', { class: 'it-hp__top' },
        el('span', { class: 'tp-label' }, t('hp', 'Hit Points')),
        el('span', { class: 'it-hp__nums tp-mono' },
          el('strong', {}, c.hp), ' / ', numField(c, 'maxHp', c.maxHp, { min: 1, title: 'Maximum hit points', cls: 'it-num--bare' }),
          c.tempHp ? el('span', { class: 'it-hp__temp', title: 'Temporary hit points' }, ` +${c.tempHp}`) : null)),
      el('span', { class: `tp-meter tp-meter--${tone}`, style: `--value:${ratio}` }),
      el('form', {
        class: 'it-hp__form',
        onSubmit: (e) => {
          e.preventDefault();
          const input = e.target.elements.amount;
          const raw = input.value.trim();
          const n = Math.abs(Math.round(Number(raw)));
          if (!raw || !Number.isFinite(n)) return;
          // "+5" heals even from the keyboard (Enter is Damage).
          const how = raw.startsWith('+') ? 'heal' : e.submitter?.value ?? 'damage';
          input.value = '';
          if (how === 'temp') act({ action: 'update', id: c.id, patch: { tempHp: n } });
          else act({ action: 'hp', id: c.id, delta: how === 'heal' ? n : -n });
        },
      },
        el('input', { class: 'tp-input it-num', name: 'amount', inputmode: 'numeric', placeholder: '0', autocomplete: 'off', 'aria-label': `Damage or healing for ${nameOf(c)}`, 'data-key': `${c.id}:amount` }),
        el('button', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--danger', value: 'damage', title: 'Damage (Enter); temporary hit points soak it first' }, 'Dmg'),
        el('button', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', value: 'heal', title: 'Heal (or type +5)' }, 'Heal'),
        el('button', { class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', value: 'temp', title: 'Set temporary hit points' }, 'Temp')));
  }

  function slotsBlock(c) {
    return el('div', { class: 'it-slots' },
      el('span', { class: 'tp-label' }, t('slots', 'Ability Slots')),
      c.slots.map((p, i) =>
        el('div', { class: 'it-pool' },
          el('span', { class: 'it-pool__label' }, p.label),
          el('span', { class: 'it-pips' },
            Array.from({ length: p.max }, (_, k) => {
              const full = k < p.max - p.used;
              return el('button', {
                type: 'button', class: `it-pip ${full ? 'is-full' : ''}`,
                title: full ? `Spend a ${p.label} slot` : `Restore a ${p.label} slot`, 'aria-label': full ? `Spend a ${p.label} slot` : `Restore a ${p.label} slot`,
                onClick: () => act({ action: 'slot', id: c.id, pool: i, delta: full ? 1 : -1 }),
              });
            })),
          el('span', { class: 'tp-mono tp-dim' }, `${p.max - p.used}/${p.max}`))),
      el('details', { class: 'it-edit' },
        el('summary', {}, c.slots.length ? 'Edit pools' : 'Add pools'),
        el('input', {
          class: 'tp-input', value: slotsText(c), placeholder: '4 3 2  or  Ki 5, Rage 3', 'data-key': `${c.id}:slots`,
          title: 'Numbers alone are spell levels (4 3 2 = 1st–3rd); or name each pool', 'aria-label': `Slot pools for ${nameOf(c)}`,
          onChange: (e) => act({ action: 'update', id: c.id, patch: { slotsText: e.target.value } }),
        })));
  }

  function conditionsBlock(c) {
    return el('div', { class: 'it-conds' },
      el('span', { class: 'tp-label' }, 'Conditions'),
      el('div', { class: 'it-conds__list' },
        c.conditions.map((x) =>
          el('span', { class: 'tp-badge tp-badge--warning it-cond', title: x.rounds ? `${x.name}: ${x.rounds} more round${x.rounds === 1 ? '' : 's'}` : x.name },
            x.name, x.rounds ? el('span', { class: 'tp-mono' }, `${x.rounds}r`) : null,
            el('button', { type: 'button', class: 'it-cond__x', 'aria-label': `Remove ${x.name}`, onClick: () => act({ action: 'condition', id: c.id, name: x.name, remove: true }) }, '×')))),
      el('form', {
        class: 'it-cond__add',
        onSubmit: (e) => {
          e.preventDefault();
          const { cond, rounds } = e.target.elements;
          if (!cond.value.trim()) return;
          act({ action: 'condition', id: c.id, name: cond.value.trim(), rounds: rounds.value ? Math.round(Number(rounds.value)) : null });
        },
      },
        el('input', { class: 'tp-input', name: 'cond', list: 'it-conditions', placeholder: 'Add…', autocomplete: 'off', 'aria-label': `Add a condition to ${nameOf(c)}`, 'data-key': `${c.id}:cond` }),
        el('input', { class: 'tp-input it-num', name: 'rounds', type: 'number', min: 1, placeholder: 'rds', title: 'Lasts this many rounds (empty: until removed)', 'aria-label': 'Rounds' }),
        el('button', { class: 'tp-frame tp-btn tp-btn--sm', title: 'Add condition', 'aria-label': 'Add condition' }, '+')));
  }

  function row(c, i) {
    const current = state.active && c.id === state.current;
    const entity = c.entityId ? candidates.find((e) => e.id === c.entityId) : null;
    return el('li', {
      class: `tp-frame it-row it-row--${c.side} ${current ? 'is-current' : ''} ${c.out ? 'is-out' : ''} ${c.hidden ? 'is-hidden' : ''}`,
      'data-id': c.id, 'aria-current': current ? 'step' : null,
    },
      el('div', { class: 'it-init' },
        el('span', { class: 'it-turn', 'aria-hidden': 'true' }, current ? '▶' : ''),
        numField(c, 'init', c.init, { nullable: true, min: -20, max: 99, title: 'Initiative' }),
        el('span', { class: 'it-move' },
          btn('▲', () => act({ action: 'move', id: c.id, to: i - 1 }), { cls: 'tp-btn--ghost', title: 'Move up', disabled: i === 0 }),
          btn('▼', () => act({ action: 'move', id: c.id, to: i + 1 }), { cls: 'tp-btn--ghost', title: 'Move down', disabled: i === state.combatants.length - 1 }))),
      el('div', { class: 'it-who' },
        portrait(c),
        el('div', { class: 'it-who__text' },
          el('strong', { class: 'it-name' }, entity ? el('a', { class: 'app-link', href: ctx.entityHref(entity), title: 'Open their page' }, nameOf(c)) : nameOf(c)),
          el('span', { class: 'app-row' },
            el('select', {
              class: 'tp-select it-side', value: c.side, 'aria-label': `Side for ${nameOf(c)}`, 'data-key': `${c.id}:side`,
              onChange: (e) => act({ action: 'update', id: c.id, patch: { side: e.target.value } }),
            }, SIDES.map(([v, label]) => el('option', { value: v }, label))),
            c.out ? el('span', { class: 'tp-badge tp-badge--danger' }, c.pc ? 'Down' : 'Defeated') : null,
            c.hidden ? el('span', { class: 'tp-badge', title: 'Not on the player screen' }, 'Hidden')
              : null))),
      hpBlock(c),
      el('label', { class: 'it-armor' }, el('span', { class: 'tp-label' }, t('armor', 'Armor')), numField(c, 'armor', c.armor, { nullable: true, min: 0, max: 99, title: t('armor', 'Armor') })),
      slotsBlock(c),
      conditionsBlock(c),
      el('div', { class: 'it-actions' },
        btn(c.hidden ? 'Reveal' : 'Hide', () => act({ action: 'update', id: c.id, patch: { hidden: !c.hidden } }), {
          cls: 'tp-btn--ghost', title: c.hidden ? 'Show on the player screen' : 'Keep off the player screen (ambushers, unseen foes)',
        }),
        btn(c.out ? 'Revive' : 'Down', () => act({ action: 'update', id: c.id, patch: { out: !c.out } }), {
          cls: 'tp-btn--ghost', title: c.out ? 'Back into the turn order' : 'Out of the fight: skipped in the order and off the player screen',
        }),
        btn('×', () => act({ action: 'remove', id: c.id }), { cls: 'tp-btn--ghost', title: `Remove ${nameOf(c)} from the fight` })));
  }

  function addPanel() {
    const group = (label, list) => (list.length ? el('optgroup', { label }, list.map((e) => el('option', { value: e.id, 'data-pc': e.data?.pc ? '1' : null }, e.name))) : null);
    const inFight = new Set(state.combatants.map((c) => c.entityId));
    const pcs = candidates.filter((e) => e.type === 'individual' && e.data?.pc && !inFight.has(e.id));
    const mobs = candidates.filter((e) => e.type === 'combatant');
    const others = candidates.filter((e) => e.type === 'individual' && !e.data?.pc);
    const count = el('input', { class: 'tp-input it-num', name: 'count', type: 'number', min: 1, max: 20, value: 1, title: 'How many (clones are numbered #1, #2…)', 'aria-label': 'How many' });
    const pick = el('select', {
      class: 'tp-select', name: 'entity', 'aria-label': 'Who joins',
      onChange: (e) => {
        const pc = e.target.selectedOptions[0]?.dataset.pc === '1';
        count.disabled = pc;
        if (pc) count.value = 1;
      },
    },
      el('option', { value: '' }, 'Choose who joins…'),
      group('Player characters', pcs), group(ctx.typeLabel('combatant', true), mobs), group(`Other ${ctx.typeLabel('individual', true).toLowerCase()}`, others));
    const side = el('select', { class: 'tp-select', name: 'side', 'aria-label': 'Side' },
      el('option', { value: '' }, 'Usual side'), SIDES.map(([v, label]) => el('option', { value: v }, label)));

    return frame('it-add',
      panelHead('Add to the fight', pcs.length ? btn(`All PCs (${pcs.length})`, async () => {
        for (const e of pcs) await act({ action: 'add', entityId: e.id });
      }, { cls: 'tp-btn--interactive', title: 'Add every player character not yet in the fight' }) : null),
      el('div', { class: 'tp-panel__body' },
        el('form', {
          class: 'it-add__row',
          onSubmit: (e) => {
            e.preventDefault();
            if (!pick.value) return pick.focus();
            act({ action: 'add', entityId: pick.value, count: Number(count.value) || 1, side: side.value || undefined });
            count.value = 1;
          },
        }, pick, el('label', { class: 'it-add__count' }, '×', count), side, el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, 'Add')),
        el('form', {
          class: 'it-add__row',
          onSubmit: (e) => {
            e.preventDefault();
            const f = e.target.elements;
            const num = (input) => (input.value.trim() === '' ? undefined : Math.round(Number(input.value)));
            if (!f.name.value.trim()) return f.name.focus();
            act({ action: 'add', name: f.name.value, hp: num(f.hp), armor: num(f.armor), initBonus: num(f.bonus), count: num(f.count) ?? 1 }).then(() => e.target.reset());
          },
        },
          el('input', { class: 'tp-input', name: 'name', placeholder: 'Or a one-off: name', autocomplete: 'off', 'aria-label': 'Name of a one-off combatant' }),
          el('input', { class: 'tp-input it-num', name: 'hp', type: 'number', min: 1, placeholder: 'HP', 'aria-label': 'Hit points' }),
          el('input', { class: 'tp-input it-num', name: 'armor', type: 'number', min: 0, placeholder: 'AR', title: 'Armor', 'aria-label': 'Armor' }),
          el('input', { class: 'tp-input it-num', name: 'bonus', type: 'number', placeholder: '+Init', title: 'Initiative bonus', 'aria-label': 'Initiative bonus' }),
          el('label', { class: 'it-add__count' }, '×', el('input', { class: 'tp-input it-num', name: 'count', type: 'number', min: 1, max: 20, value: 1, 'aria-label': 'How many' })),
          el('button', { class: 'tp-frame tp-btn' }, 'Add one-off')),
        !candidates.some((e) => e.type === 'combatant')
          ? el('p', { class: 'tp-muted it-hint' }, `Tip: create ${ctx.typeLabel('combatant', true)} for foes you reuse, and tick "Player character" on your players' ${ctx.typeLabel('individual', true)}.`)
          : null));
  }

  function controls() {
    const s = state;
    const acting = s.combatants.find((c) => c.id === s.current);
    const unrolled = s.combatants.filter((c) => !c.pc && c.init == null).length;
    return frame('it-controls',
      el('div', { class: 'tp-panel__body it-controls__body' },
        el('div', { class: 'it-status' },
          s.active
            ? [el('span', { class: 'tp-label' }, 'Round'), el('strong', { class: 'it-round tp-mono' }, s.round),
                el('span', { class: 'it-status__turn' }, acting ? [el('span', { class: 'tp-dim' }, 'Turn: '), el('strong', {}, nameOf(acting))] : 'Nobody can act')]
            : [el('span', { class: 'tp-label' }, 'Not in combat'), el('span', { class: 'tp-muted' }, 'Players see the order once you start.')]),
        el('div', { class: 'app-actions' },
          s.active
            ? [
                btn('◀ Back', () => act({ action: 'prev' }), { title: 'Previous turn (P)' }),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary it-next', title: 'Next turn (N)', onClick: () => act({ action: 'next' }) }, 'Next turn ▶'),
                unrolled ? btn(`Roll ${unrolled}`, () => act({ action: 'roll' }), { title: 'Roll initiative for everyone the GM controls who has none' }) : null,
                btn('End combat', async () => {
                  if (await confirmDialog({ title: 'End combat?', body: 'Foes leave the tracker and the turn order disappears from the player screen. Player characters stay, with their hit points, slots and conditions.', confirmLabel: 'End combat', danger: true })) act({ action: 'end' });
                }, { cls: 'tp-btn--danger' }),
              ]
            : [
                unrolled ? btn(`Roll ${unrolled}`, () => act({ action: 'roll' }), { title: 'Roll initiative for everyone the GM controls who has none' }) : null,
                btn('Long rest', () => act({ action: 'rest' }), { cls: 'tp-btn--ghost', title: 'Player characters: full hit points and slots, conditions cleared' }),
                s.combatants.length ? btn('Clear', async () => {
                  if (await confirmDialog({ title: 'Clear the tracker?', body: 'Everyone leaves the tracker, player characters included.', confirmLabel: 'Clear', danger: true })) act({ action: 'clear' });
                }, { cls: 'tp-btn--ghost' }) : null,
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary it-next', disabled: !s.combatants.length, title: 'Rolls anyone the GM controls who has no initiative, then shows the order to players', onClick: () => act({ action: 'start' }) }, 'Start combat'),
              ])));
  }

  // The attack form follows the turn: the acting combatant attacks, and the last
  // target stays picked until it drops (so repeated swings at one foe are quick).
  const pick = { turn: null, attacker: null, target: null };

  function attackPanel() {
    const s = state;
    const able = s.combatants.filter((c) => !c.out);
    if (pick.turn !== s.current) Object.assign(pick, { turn: s.current, attacker: s.current });
    if (!able.some((c) => c.id === pick.attacker)) pick.attacker = able[0]?.id ?? null;
    const attacker = able.find((c) => c.id === pick.attacker);
    const foes = (c) => (c?.side === 'enemy' ? ['pc', 'ally'] : ['enemy']);
    if (!able.some((c) => c.id === pick.target) || pick.target === pick.attacker) {
      pick.target = (able.find((c) => c.id !== pick.attacker && foes(attacker).includes(c.side)) ?? able.find((c) => c.id !== pick.attacker))?.id ?? null;
    }
    const options = (selected, skip) => able.filter((c) => c.id !== skip).map((c) => el('option', { value: c.id, selected: c.id === selected }, `${nameOf(c)}${c.id === s.current ? ' (turn)' : ''}`));
    const last = s.attack && [s.combatants.find((c) => c.id === s.attack.attackerId), s.combatants.find((c) => c.id === s.attack.targetId)];
    const verb = { hit: 'hit', crit: 'critically hit', miss: 'missed' };

    return frame('it-attack',
      el('form', {
        class: 'tp-panel__body it-attack__form',
        onSubmit: (e) => {
          e.preventDefault();
          const f = e.target.elements;
          const result = e.submitter?.value ?? 'hit';
          const damage = Math.max(0, Math.round(Number(f.damage.value) || 0));
          if (result !== 'miss' && !f.damage.value.trim()) return f.damage.focus();
          pick.target = f.target.value;
          act({ action: 'attack', attackerId: f.attacker.value, targetId: f.target.value, result, damage });
        },
      },
        el('span', { class: 'tp-label' }, 'Attack'),
        el('select', {
          class: 'tp-select', name: 'attacker', 'aria-label': 'Attacker',
          onChange: (e) => ((pick.attacker = e.target.value), render()),
        }, options(pick.attacker)),
        el('span', { class: 'it-attack__arrow', 'aria-hidden': 'true' }, '→'),
        el('select', { class: 'tp-select', name: 'target', 'aria-label': 'Target', onChange: (e) => (pick.target = e.target.value) }, options(pick.target, pick.attacker)),
        el('input', { class: 'tp-input it-num', name: 'damage', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Dmg', 'aria-label': 'Damage', 'data-key': 'attack:damage' }),
        el('button', { class: 'tp-frame tp-btn tp-btn--danger', value: 'hit', title: 'Hit (Enter): deal the damage and play the attack on the player screen' }, 'Hit'),
        el('button', { class: 'tp-frame tp-btn tp-btn--primary', value: 'crit', title: 'Critical hit' }, 'Crit'),
        el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'miss', title: 'Miss: no damage, the target dodges on the player screen' }, 'Miss'),
        last?.[0] && last[1]
          ? el('span', { class: 'tp-muted it-attack__last' },
              `Last: ${nameOf(last[0])} ${verb[s.attack.result]} ${nameOf(last[1])}${s.attack.damage ? ` for ${s.attack.damage}` : ''}${s.attack.down ? ', down' : ''}`)
          : null));
  }

  function render() {
    // Live updates redraw everything: keep the GM's place.
    const focused = document.activeElement?.dataset?.key;
    const caret = focused && document.activeElement.selectionStart;
    const open = new Set([...page.querySelectorAll('details[open]')].map((d) => d.closest('[data-id]')?.dataset.id));
    const acting = state.combatants.find((c) => c.id === state.current);

    page.replaceChildren(
      el('div', { class: 'app-page__head' },
        el('h1', { class: 'tp-h1' }, t('initiative', 'Initiative Tracker')),
        el('span', { class: 'tp-deco' }, state.active ? `ROUND ${state.round}${acting ? ` // ${nameOf(acting)}` : ''} // ON THE PLAYER SCREEN` : `${state.combatants.length} READY // NOT IN COMBAT`)),
      controls(),
      state.active && state.combatants.filter((c) => !c.out).length > 1 ? attackPanel() : null,
      state.combatants.length
        ? el('ol', { class: 'it-order' }, state.combatants.map(row))
        : frame('', emptyState('Nobody is in the fight', 'Add player characters and foes below, then start combat.')),
      addPanel(),
      el('datalist', { id: 'it-conditions' }, CONDITIONS.map((name) => el('option', { value: name }))),
    );
    for (const id of open) page.querySelector(`[data-id="${id}"] details`)?.setAttribute('open', '');
    if (focused) {
      const input = page.querySelector(`[data-key="${CSS.escape(focused)}"]`);
      input?.focus();
      try {
        if (caret != null) input?.setSelectionRange(caret, caret);
      } catch {
        /* number inputs have no caret */
      }
    }
  }

  const onKey = (e) => {
    if (!state.active || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, dialog')) return;
    if (e.key === 'n' || e.key === 'N') act({ action: 'next' });
    if (e.key === 'p' || e.key === 'P') act({ action: 'prev' });
  };
  document.addEventListener('keydown', onKey);

  await loadCandidates();
  render();
  return {
    async update() {
      await loadCandidates();
      render();
    },
    relabel: render,
    async encounter() {
      show(await ctx.api.encounter());
    },
    unmount: () => document.removeEventListener('keydown', onKey),
  };
}
