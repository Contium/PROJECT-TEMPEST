// Project settings (#/settings): the open project's money and map system.
// Changes are drafted on the page and saved together; the server checks them
// with the same rules (settings-model.js).

import { el, toast, toastError } from '../ui.js';
import { projects as api } from '../api.js';
import { MONEY_MODES, MAP_MODES, DND_COINS, MAX_CURRENCIES, UNIQUE_POI_MODES, normalizeSettings, currencies, formatAmount, rate, SettingsError } from './settings-model.js';
import { UNIQUE_POIS } from '../maps/poi-model.js';
import { formatLonLat } from '../maps/globe-math.js';
import { networkCards } from './network.js';

const SAMPLE = 12345; // the example amount, in base units

/** mount(root, { project, saved }) — saved(project) tells the shell the project changed. */
export async function mount(root, { project, saved: onSaved }) {
  let original = normalizeSettings(project.settings);
  let draft = structuredClone(original);
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(original);

  /** The draft checked against the rules: { settings } or { problems }. */
  const check = () => {
    try {
      return { settings: normalizeSettings(draft) };
    } catch (err) {
      if (err instanceof SettingsError) return { problems: err.problems };
      throw err;
    }
  };

  function cards(name, options, value, pick, { soon = false } = {}) {
    return el('div', { class: 'st-cards', role: 'radiogroup' },
      options.map((o) =>
        el('label', { class: `st-card ${value === o.id ? 'is-on' : ''}` },
          el('input', { type: 'radio', name, value: o.id ?? '', checked: value === o.id, onChange: () => (pick(o.id), render()) }),
          // Only what isn't ready yet gets a badge.
          el('span', { class: 'st-card__label' }, o.label, soon && o.id && !o.ready ? el('span', { class: 'tp-badge st-soon' }, 'Coming later') : null),
          el('span', { class: 'tp-dim st-card__hint' }, o.hint))));
  }

  // --- money ------------------------------------------------------------------------------

  function dndSetup() {
    return el('table', { class: 'tp-table st-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Coin'), el('th', {}, 'Symbol'), el('th', {}, 'Worth'))),
      el('tbody', {}, DND_COINS.map((c) => el('tr', {}, el('td', {}, c.name), el('td', { class: 'tp-mono' }, c.symbol), el('td', { class: 'tp-mono' }, c.value === 1 ? '1 cp (base)' : `${c.value} cp`)))));
  }

  function singleSetup() {
    const s = draft.money.single;
    const update = (patch) => ((draft.money.single = { ...draft.money.single, ...patch }), renderMoneyPreview(), renderFoot());
    return el('div', { class: 'st-row' },
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Name'),
        el('input', { class: 'tp-input', value: s.name, maxlength: 30, placeholder: 'Eurodollar', onInput: (e) => update({ name: e.target.value }) })),
      el('label', { class: 'tp-field st-symbol' }, el('span', { class: 'tp-label' }, 'Symbol'),
        el('input', { class: 'tp-input', value: s.symbol, maxlength: 6, placeholder: '§', onInput: (e) => update({ symbol: e.target.value }) })),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Symbol goes'),
        el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Symbol position' },
          [['before', 'Before'], ['after', 'After']].map(([v, label]) =>
            el('button', { type: 'button', class: `fd-seg__btn ${s.position === v ? 'is-on' : ''}`, 'aria-pressed': String(s.position === v), onClick: () => (update({ position: v }), render()) }, label)))));
  }

  function customSetup() {
    const list = draft.money.custom;
    const base = list[0]?.name || 'base';
    const update = (i, patch, redraw = false) => {
      list[i] = { ...list[i], ...patch };
      renderMoneyPreview();
      renderFoot();
      if (redraw) render();
    };
    const move = (i, by) => {
      const j = i + by;
      [list[i], list[j]] = [list[j], list[i]];
      list[0].value = 1;
      render();
    };
    return el('div', { class: 'st-currencies' },
      el('div', { class: 'st-currency st-currency--head', 'aria-hidden': 'true' },
        el('span', { class: 'tp-label' }, 'Name'), el('span', { class: 'tp-label' }, 'Symbol'), el('span', { class: 'tp-label' }, `Worth (in ${base})`), el('span')),
      list.map((c, i) =>
        el('div', { class: 'st-currency' },
          el('input', { class: 'tp-input', value: c.name, maxlength: 30, 'aria-label': `Currency ${i + 1} name`, onInput: (e) => update(i, { name: e.target.value }) }),
          el('input', { class: 'tp-input', value: c.symbol ?? '', maxlength: 6, 'aria-label': `Currency ${i + 1} symbol`, onInput: (e) => update(i, { symbol: e.target.value }) }),
          i === 0
            ? el('span', { class: 'tp-dim st-base' }, 'Base: 1')
            : el('input', { class: 'tp-input', type: 'number', min: 0, step: 'any', value: c.value, 'aria-label': `${c.name || `Currency ${i + 1}`} is worth how many ${base}`, onInput: (e) => update(i, { value: Number(e.target.value) }) }),
          el('span', { class: 'st-currency__tools' },
            el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move up', title: i === 1 ? 'Make this the base currency' : 'Move up', disabled: i === 0, onClick: () => move(i, -1) }, '▲'),
            el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move down', disabled: i === list.length - 1, onClick: () => move(i, 1) }, '▼'),
            el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove ${c.name || 'currency'}`, disabled: list.length < 2, onClick: () => { list.splice(i, 1); list[0].value = 1; render(); } }, '×')))),
      list.length < MAX_CURRENCIES
        ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => { list.push({ id: `c${Date.now().toString(36)}`, name: '', symbol: '', value: (list.at(-1)?.value ?? 1) * 10 }); render(); } }, `+ Currency (${list.length} of ${MAX_CURRENCIES})`)
        : el('span', { class: 'tp-dim' }, `${MAX_CURRENCIES} currencies is the most a project can have.`),
      el('p', { class: 'tp-dim st-note' }, `The first currency is the base: every other one says how many ${base} it's worth. ▲ moves a currency up; moving one to the top makes it the base.`));
  }

  const preview = el('div', { class: 'st-preview' });
  function renderMoneyPreview() {
    const { settings } = check();
    if (!settings) return preview.replaceChildren();
    const list = currencies(settings);
    const sample = settings.money.mode === 'single' ? 1250 : SAMPLE;
    // replaceChildren() would print a null: leave the rates out when there's one currency.
    preview.replaceChildren(...[
      el('span', { class: 'tp-label' }, 'How it reads'),
      el('p', { class: 'st-sample tp-mono' }, formatAmount(sample, settings)),
      list.length > 1
        ? el('ul', { class: 'st-rates' }, list.slice(1).map((c) => el('li', { class: 'tp-mono' }, `1 ${c.name} = ${rate(c, list[0]).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${list[0].name}`)))
        : null,
    ].filter(Boolean));
  }

  // --- unique locations (Planetary and Galactic maps) -------------------------------------

  /** Built-in POIs with systems of their own, switched on or off per project. */
  function uniques() {
    return el('div', { class: 'st-uniques' },
      el('h3', { class: 'tp-label st-uniques__title' }, 'Unique locations'),
      UNIQUE_POIS.map((u) => {
        const on = draft.maps[u.key]?.enabled !== false;
        return el('label', { class: `st-card st-unique ${on ? 'is-on' : ''}` },
          el('input', { type: 'checkbox', checked: on, onChange: (e) => { draft.maps[u.key] = { ...draft.maps[u.key], enabled: e.target.checked }; render(); } }),
          el('span', { class: 'st-card__label' }, u.name, el('span', { class: 'tp-badge tp-badge--interactive st-soon' }, 'Unique'), el('span', { class: 'tp-mono tp-dim st-unique__where' }, formatLonLat(u))),
          el('span', { class: 'tp-dim st-card__hint' }, `${u.description} Shows on the ${draft.maps.mode === 'galactic' ? 'star map as a unique Settlement (drag it where you like)' : 'map as a unique City'} with its own City Map${on ? '' : ' (off)'}.`));
      }));
  }

  // --- page ------------------------------------------------------------------------------

  const foot = el('div', { class: 'st-foot' });
  // Applies at once and to every project, so it sits apart from the drafted settings.
  const network = networkCards();
  function renderFoot() {
    const { problems } = check();
    foot.replaceChildren(
      problems ? el('ul', { class: 'st-problems' }, problems.map((p) => el('li', {}, p))) : el('span', { class: `fd-status ${dirty() ? 'is-dirty' : ''}` }, dirty() ? 'Unsaved changes' : 'Saved'),
      el('span', { class: 'app-actions' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', disabled: !dirty(), onClick: () => ((draft = structuredClone(original)), render()) }, 'Discard changes'),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', disabled: !dirty() || Boolean(problems), onClick: save }, 'Save settings')));
  }

  async function save() {
    try {
      const updated = await api.update(project.id, { settings: check().settings });
      project = updated;
      original = normalizeSettings(updated.settings);
      draft = structuredClone(original);
      onSaved?.(updated);
      toast('Settings saved', { tone: 'success' });
      render();
    } catch (err) {
      toastError(err);
    }
  }

  function render() {
    const mode = draft.money.mode;
    root.replaceChildren(
      el('div', { class: 'app-page st' },
        el('div', { class: 'app-page__head' },
          el('h1', { class: 'tp-h1' }, 'Project settings'),
          el('span', { class: 'tp-deco' }, project.name)),
        el('section', { class: 'tp-frame tp-panel' },
          el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Money'), el('span', { class: 'tp-dim' }, 'How prices and purses are counted in this project')),
          el('div', { class: 'tp-panel__body' },
            cards('money', MONEY_MODES, mode, (m) => (draft.money.mode = m)),
            el('div', { class: 'st-setup' },
              el('div', {}, mode === 'dnd' ? dndSetup() : mode === 'single' ? singleSetup() : customSetup()),
              preview))),
        el('section', { class: 'tp-frame tp-panel' },
          el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Map system'), el('span', { class: 'tp-dim' }, 'How this project\'s world will be mapped')),
          el('div', { class: 'tp-panel__body' },
            cards('maps', [...MAP_MODES, { id: null, label: 'Decide later', hint: 'No map system yet' }], draft.maps.mode, (m) => (draft.maps.mode = m), { soon: true }),
            el('p', { class: 'tp-dim st-note' }, 'Each map system adds a section of its own: Planes, World View, Atlas or Star Map. Switching systems keeps what you made in each, ready for when you switch back.'),
            UNIQUE_POI_MODES.includes(draft.maps.mode) ? uniques() : null)),
        foot,
        network),
    );
    renderMoneyPreview();
    renderFoot();
  }

  const onUnload = (e) => dirty() && e.preventDefault();
  window.addEventListener('beforeunload', onUnload);
  render();
  document.title = `TEMPEST · Settings`;
  return { unmount: () => window.removeEventListener('beforeunload', onUnload) };
}
