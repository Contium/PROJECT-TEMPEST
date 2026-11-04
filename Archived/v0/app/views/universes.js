// Home: pick or create a universe.

import { universes } from '../api.js';
import { el, frame, panelHead, toastError, emptyState } from '../ui.js';

/** Calendar picker shared with Settings. Returns { node, read() }. */
export function calendarFields(current = { type: 'gregorian', epoch: '2045-08-01T00:00' }) {
  const type = el('select', { class: 'tp-select', 'aria-label': 'Calendar type', value: current.type },
    el('option', { value: 'gregorian' }, 'Real dates (modern / future settings)'),
    el('option', { value: 'years' }, 'Years & days (fantasy / sci-fi, e.g. 1492 DR)'),
    el('option', { value: 'days' }, 'Day count (simple homebrew)'),
  );
  const epoch = el('input', { class: 'tp-input', type: 'datetime-local', value: current.epoch ?? '2045-08-01T00:00' });
  const epochYear = el('input', { class: 'tp-input', type: 'number', step: 1, value: current.epochYear ?? 1 });
  const daysPerYear = el('input', { class: 'tp-input', type: 'number', min: 1, step: 1, value: current.daysPerYear ?? 365 });
  const suffix = el('input', { class: 'tp-input', value: current.suffix ?? '', placeholder: 'e.g. DR, BBY, AC' });

  const field = (label, input) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), input);
  const gregorian = el('div', { class: 'app-row' }, field('Play starts on', epoch));
  const years = el('div', { class: 'app-row' }, field('Play starts in year', epochYear), field('Days per year', daysPerYear), field('Year suffix', suffix));
  const paint = () => {
    gregorian.hidden = type.value !== 'gregorian';
    years.hidden = type.value !== 'years';
  };
  type.addEventListener('change', paint);
  paint();

  return {
    node: el('div', { class: 'app-stack' }, field('Calendar', type), gregorian, years),
    read() {
      if (type.value === 'gregorian') return { type: 'gregorian', epoch: epoch.value };
      if (type.value === 'years') {
        return { type: 'years', epochYear: Number(epochYear.value), daysPerYear: Number(daysPerYear.value) || 365, ...(suffix.value.trim() ? { suffix: suffix.value.trim() } : {}) };
      }
      return { type: 'days' };
    },
  };
}

export async function mount(root, ctx) {
  const list = await universes.list();
  const themes = ctx.engine.list();
  let last = null;
  try {
    last = localStorage.getItem('tempest.lastUniverse');
  } catch {
    /* ignore */
  }

  const card = (x) =>
    el(
      'a',
      { class: 'tp-frame app-card', href: `#/u/${x.id}` },
      el('span', { class: 'tp-h3' }, x.name ?? x.id),
      el('span', { class: 'tp-deco' }, x.system ?? 'No game system set'),
      x.summary ? el('span', { class: 'tp-muted app-card__summary' }, x.summary) : null,
      x.error ? el('span', { class: 'app-error' }, x.error) : null,
      el(
        'span',
        { class: 'app-card__meta' },
        el('span', { class: 'tp-mono tp-muted' }, [x.era?.name, x.clockLabel].filter(Boolean).join(' · ')),
        x.id === last ? el('span', { class: 'tp-badge tp-badge--interactive' }, 'Last opened') : null,
      ),
    );

  const calendar = calendarFields();
  const form = el(
    'form',
    { class: 'tp-panel__body' },
    el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Name'), el('input', { class: 'tp-input', name: 'name', required: true, placeholder: 'e.g. The Forgotten Realms' })),
    el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Game system'), el('input', { class: 'tp-input', name: 'system', placeholder: 'e.g. D&D 5e, Cyberpunk RED, Edge of the Empire' })),
    el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Summary'), el('textarea', { class: 'tp-textarea', name: 'summary', placeholder: 'The premise of this universe in a few lines' })),
    el(
      'label',
      { class: 'tp-field' },
      el('span', { class: 'tp-label' }, 'Theme'),
      el('select', { class: 'tp-select', name: 'theme', value: ctx.engine.current?.id }, themes.map((t) => el('option', { value: t.id }, t.name))),
    ),
    calendar.node,
    el('div', { class: 'app-actions' }, el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, 'Create universe')),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    try {
      const created = await universes.create({
        name: data.get('name'),
        system: data.get('system') || null,
        summary: data.get('summary') || null,
        theme: data.get('theme'),
        calendar: calendar.read(),
      });
      ctx.go(`/u/${created.id}`);
    } catch (err) {
      toastError(err);
    }
  });

  root.append(
    el(
      'div',
      { class: 'app-page' },
      el('div', { class: 'app-page__head' }, el('h1', { class: 'tp-h1' }, ctx.engine.t('universe.plural', 'Universes')), el('span', { class: 'tp-deco' }, `${list.length} ON FILE`)),
      list.length
        ? el('div', { class: 'app-grid' }, list.map(card))
        : frame('', emptyState('No universes yet', 'Create one below, or run "npm run seed" for the Cyberpunk RED sample.')),
      frame('', panelHead('New universe'), form),
    ),
  );
}
