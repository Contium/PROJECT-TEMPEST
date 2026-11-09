// The project picker (#/projects): create, open, rename and delete projects.
// Everything the user makes (presets, characters, images) lives in a project,
// so this is where a session starts when no project is open yet, and where the
// project button at the top left leads.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { projects as api } from '../api.js';

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * mount(root, { engine, current, open })
 *   current  the open project, or null
 *   open     (project) → opens it (main.js switches the whole app over)
 */
export async function mount(root, { engine, current, open }) {
  let list = [];
  let editing = null; // id of the project being renamed

  async function refresh() {
    list = await api.list().catch((err) => (toastError(err), list));
    render();
  }

  const themeOptions = (selected) => [
    el('option', { value: '' }, 'Current theme'),
    ...engine.list().map((t) => el('option', { value: t.id, selected: t.id === selected }, t.name)),
  ];

  function newCard() {
    return el('form', {
      class: 'tp-frame tp-panel pj-card pj-card--new',
      onSubmit: async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        if (!f.name.value.trim()) return f.name.focus();
        try {
          const made = await api.create({ name: f.name.value, description: f.description.value, theme: f.theme.value || engine.current?.id });
          toast(`Created "${made.name}"`, { tone: 'success' });
          await open(made);
        } catch (err) {
          toastError(err);
        }
      },
    },
      el('div', { class: 'tp-panel__body' },
        el('span', { class: 'tp-label' }, 'New project'),
        el('input', { class: 'tp-input', name: 'name', placeholder: 'Project name, e.g. Night City Nights', maxlength: 80, required: true, 'aria-label': 'Project name', autofocus: !list.length }),
        el('textarea', { class: 'tp-textarea', name: 'description', rows: 2, placeholder: 'What it is (optional)', maxlength: 400, 'aria-label': 'Description' }),
        el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Theme'), el('select', { class: 'tp-select', name: 'theme' }, themeOptions(''))),
        el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, 'Create project')));
  }

  function card(p) {
    const isCurrent = p.id === current?.id;
    if (editing === p.id) {
      return el('form', {
        class: 'tp-frame tp-panel pj-card is-editing',
        onSubmit: async (e) => {
          e.preventDefault();
          const f = e.target.elements;
          try {
            const saved = await api.update(p.id, { name: f.name.value, description: f.description.value, theme: f.theme.value || null });
            editing = null;
            if (isCurrent) await open(saved, { stay: true });
            await refresh();
          } catch (err) {
            toastError(err);
          }
        },
      },
        el('div', { class: 'tp-panel__body' },
          el('input', { class: 'tp-input', name: 'name', value: p.name, maxlength: 80, required: true, 'aria-label': 'Project name' }),
          el('textarea', { class: 'tp-textarea', name: 'description', rows: 2, maxlength: 400, 'aria-label': 'Description' }, p.description ?? ''),
          el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Theme'), el('select', { class: 'tp-select', name: 'theme' }, themeOptions(p.theme))),
          el('div', { class: 'app-actions' },
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => ((editing = null), render()) }, 'Cancel'),
            el('button', { class: 'tp-frame tp-btn tp-btn--primary' }, 'Save'))));
    }
    const theme = engine.list().find((t) => t.id === p.theme)?.name;
    return el('article', { class: `tp-frame tp-panel pj-card ${isCurrent ? 'is-current' : ''}` },
      el('div', { class: 'tp-panel__body' },
        el('div', { class: 'pj-card__top' },
          el('h2', { class: 'tp-h3 pj-card__name' }, p.name),
          isCurrent ? el('span', { class: 'tp-badge tp-badge--interactive' }, 'Open') : null),
        p.description ? el('p', { class: 'pj-card__desc' }, p.description) : null,
        el('p', { class: 'tp-dim pj-card__meta' },
          [plural(p.counts?.characters ?? 0, 'character'), plural(p.counts?.presets ?? 0, 'preset'), theme, `opened ${when(p.openedAt ?? p.createdAt)}`].filter(Boolean).join(' · ')),
        el('div', { class: 'pj-card__actions' },
          el('button', { type: 'button', class: `tp-frame tp-btn ${isCurrent ? '' : 'tp-btn--primary'}`, onClick: () => open(p) }, isCurrent ? 'Continue' : 'Open'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => ((editing = p.id), render()) }, 'Rename'),
          el('button', {
            type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', title: 'Money and map system',
            onClick: async () => {
              await open(p, { stay: true }); // switch to it, then go straight to its settings
              location.hash = '#/settings';
            },
          }, 'Settings'),
          el('button', {
            // Kept apart at the far end of the row, away from Open.
            type: 'button', class: 'tp-frame tp-btn tp-btn--ghost pj-card__delete',
            onClick: async () => {
              const ok = await confirmDialog({
                title: `Delete "${p.name}"?`,
                body: `Its ${plural(p.counts?.characters ?? 0, 'character')}, ${plural(p.counts?.presets ?? 0, 'preset')} and images go with it. It goes to TEMPEST's trash folder rather than being erased, so it can still be recovered.`,
                confirmLabel: 'Delete project', danger: true,
              });
              if (!ok) return;
              try {
                await api.remove(p.id);
                toast(`Deleted "${p.name}"`);
                if (isCurrent) await open(null, { stay: true });
                current = isCurrent ? null : current;
                await refresh();
              } catch (err) {
                toastError(err);
              }
            },
          }, 'Delete'))));
  }

  function render() {
    root.replaceChildren(
      el('div', { class: 'app-page pj' },
        el('div', { class: 'app-page__head' },
          el('h1', { class: 'tp-h1' }, 'Projects'),
          el('span', { class: 'tp-deco' }, current ? `Open: ${current.name}` : 'Choose or create a project')),
        el('p', { class: 'tp-muted pj-lead' }, list.length
          ? 'Each project keeps its own presets, characters and images, separate from every other project.'
          : 'Welcome to TEMPEST. Start with a project: one per campaign or setting. Everything you make lives inside it.'),
        el('div', { class: 'pj-grid' }, newCard(), list.map(card))),
    );
    root.querySelector('[autofocus]')?.focus();
  }

  render();
  await refresh();
  document.title = 'TEMPEST · Projects';
  return {};
}
