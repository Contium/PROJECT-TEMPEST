// Universe settings: details, current session, calendar, custom entity types.

import { el, frame, panelHead, toast, toastError } from '../ui.js';
import { calendarFields } from './universes.js';

const FIELD_TYPES = [
  ['text', 'Short text'], ['longtext', 'Long text'], ['number', 'Number'], ['bool', 'Yes / No'],
  ['enum', 'Choice list'], ['tier', 'Tier 1–5'], ['meter', 'Meter 0–100%'], ['ref', 'Link to entity'],
  ['refs', 'Links to entities'], ['tags', 'Tags'], ['gametime', 'In-game time'], ['image', 'Image'], ['gallery', 'Image gallery (e.g. maps)'],
];

const toKey = (text) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1');

export async function mount(root, ctx) {
  const page = el('div', { class: 'app-page' });
  root.append(page);

  async function render() {
    const meta = ctx.meta;
    const sessions = await ctx.api.list({ type: 'session', sort: 'created' });
    const themes = ctx.engine.list();

    // --- Details
    const details = el(
      'form',
      { class: 'tp-panel__body' },
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Name'), el('input', { class: 'tp-input', name: 'name', value: meta.name, required: true })),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Game system'), el('input', { class: 'tp-input', name: 'system', value: meta.system ?? '' })),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Summary'), el('textarea', { class: 'tp-textarea', name: 'summary', value: meta.summary ?? '' })),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Theme'),
        el('select', { class: 'tp-select', name: 'theme', value: meta.theme ?? '' }, themes.map((t) => el('option', { value: t.id }, t.name)))),
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, `Current ${ctx.typeLabel('session').toLowerCase()}`),
        el('select', { class: 'tp-select', name: 'active_session', value: meta.active_session ?? '' },
          el('option', { value: '' }, 'None (changes are not tied to a session)'),
          sessions.map((s) => el('option', { value: s.id }, s.name))),
        el('span', { class: 'ed__hint' }, 'Every change you make is stamped with this, so you can review a session afterwards.')),
      el('div', { class: 'app-actions' }, el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, 'Save')),
    );
    details.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(details);
      try {
        await ctx.api.setMeta({
          name: f.get('name'), system: f.get('system') || null, summary: f.get('summary') || null,
          theme: f.get('theme'), active_session: f.get('active_session') || null,
        });
        if (f.get('theme') !== ctx.engine.current?.id) await ctx.engine.apply(f.get('theme'));
        await ctx.refreshShell();
        toast(`${ctx.engine.t('universe', 'Universe')} saved`, { tone: 'success' });
      } catch (err) {
        toastError(err);
      }
    });

    // --- Calendar
    const cal = calendarFields(meta.calendar ?? { type: 'days' });
    const calendar = el(
      'form',
      { class: 'tp-panel__body' },
      el('p', { class: 'tp-muted' }, 'History is stored as time since the start of play, so changing this relabels every date without moving any event.'),
      cal.node,
      el('div', { class: 'app-actions' }, el('button', { class: 'tp-frame tp-btn' }, 'Update calendar')),
    );
    calendar.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await ctx.api.setMeta({ calendar: cal.read() });
        await ctx.refreshShell();
        toast('Calendar updated', { tone: 'success' });
        render();
      } catch (err) {
        toastError(err);
      }
    });

    page.replaceChildren(
      el('div', { class: 'app-page__head' }, el('h1', { class: 'tp-h1' }, 'Settings'), el('span', { class: 'tp-deco' }, `${meta.id} // ${meta.clockLabel}`)),
      el('div', { class: 'app-grid' }, frame('', panelHead(ctx.engine.t('universe', 'Universe')), details), frame('', panelHead('Calendar'), calendar)),
      typesPanel(),
    );
  }

  function typesPanel() {
    const list = el('div', { class: 'app-row' }, ctx.types.map((t) => el('span', { class: `tp-badge ${t.builtin ? '' : 'tp-badge--interactive'}`, title: `${t.fields.length} fields` }, ctx.typeLabel(t, true))));

    const name = el('input', { class: 'tp-input', required: true, placeholder: 'e.g. Starship' });
    const plural = el('input', { class: 'tp-input', placeholder: 'e.g. Starships' });
    const rows = el('div', { class: 'app-stack' });
    const addRow = () => {
      const label = el('input', { class: 'tp-input', placeholder: 'Field label', required: true });
      const kind = el('select', { class: 'tp-select' }, FIELD_TYPES.map(([v, l]) => el('option', { value: v }, l)));
      const options = el('input', { class: 'tp-input', placeholder: 'choices, comma separated', hidden: true });
      const secret = el('input', { type: 'checkbox' });
      kind.addEventListener('change', () => (options.hidden = kind.value !== 'enum'));
      const row = el('div', { class: 'app-row' }, label, kind, options, el('label', { class: 'tp-check' }, secret, el('span', {}, 'Always secret')),
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', onClick: () => row.remove() }, '×'));
      row.read = () => ({
        key: toKey(label.value),
        label: label.value.trim(),
        type: kind.value,
        ...(kind.value === 'enum' ? { options: options.value.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
        ...(secret.checked ? { secret: true } : {}),
      });
      rows.append(row);
    };
    addRow();

    const form = el(
      'form',
      { class: 'tp-panel__body' },
      el('p', { class: 'tp-muted' }, 'Add a kind of thing your game tracks that the built-in levels don\'t cover. Tags, Rumour and GM Notes are added automatically.'),
      list,
      el('div', { class: 'app-row' }, name, plural),
      rows,
      el('div', { class: 'app-actions' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: addRow }, '+ Field'),
        el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, 'Create type')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = [...rows.children].map((r) => r.read()).filter((f) => f.key);
      const def = {
        id: toKey(name.value).slice(0, 32),
        name: name.value.trim(),
        plural: plural.value.trim() || `${name.value.trim()}s`,
        category: 'extra',
        fields: [
          ...fields,
          { key: 'tags', type: 'tags', label: 'Tags' },
          { key: 'rumor', type: 'longtext', label: 'Rumour' },
          { key: 'gm_notes', type: 'longtext', label: 'GM Notes', secret: true },
        ],
      };
      try {
        await ctx.api.defineType(def);
        await ctx.refreshShell();
        toast(`${def.name} added to the sidebar`, { tone: 'success' });
        render();
      } catch (err) {
        toastError(err);
      }
    });
    return frame('', panelHead('Entity types', el('span', { class: 'tp-deco' }, `${ctx.types.length} DEFINED`)), form);
  }

  await render();
  return { relabel: render };
}
