// The tabs that list what The Forge made, and each entry's page:
//   Characters › Players / NPCs / Monsters / Creatures   (characters, by Category)
//   World › Events / Stories / Rumors                     (stories, by Type)
//   Items                                                 (items: one list, filtered by rarity)
//
//   #/<section>/<tab>        cards for every entry in that category (Items: #/items)
//   #/<section>/<tab>/<id>   one entry: its sheet (GM or player view), Edit, Delete (Items: #/items/<id>)
//
// An entry's sheet is the snapshot of the preset it was forged from, so it keeps
// its shape even if that preset changes later. Editing reuses the Forge's values
// form; changing the category (Category / Type) moves the entry to another tab.

import { el, toast, toastError, confirmDialog, store } from '../ui.js';
import { entitiesApi, allEntities, imageUrl, currentProjectId } from '../api.js';
import { renderSheet, rarityBadge } from '../forge/sheet.js';
import { valuesForm } from '../forge/values-form.js';
import { categoryForTab, categoryOf, normalizeEntity, hrefOf, plural } from '../forge/entity-model.js';
import { kindOf, formatDate } from '../forge/preset-model.js';
import { push, pushButton } from '../push/push.js';
import { openImage } from '../image-viewer.js';

const initials = (name) => name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '·';

/** The line under a card's name: Species · Size, or Start – End. */
function meta(e) {
  if (e.kind === 'stories') {
    if (!e.start) return 'Undated';
    return `${formatDate(e.start)} – ${e.end ? formatDate(e.end) : 'ongoing'}`;
  }
  if (e.kind === 'items') return [e.itemtype || 'Item', e.rarity ? rarityBadge(e.rarity) : null];
  return [e.species, e.size].filter(Boolean).join(' · ') || '—';
}

export async function mount(root, { section, tab, item }) {
  // Items have no tabs: the section itself is the list.
  const { kind, category } = tab ? categoryForTab(tab.id) : { kind: section.id, category: null };
  const everyone = await allEntities().catch((err) => (toastError(err), []));
  const lookup = (id) => {
    const e = everyone.find((x) => x.id === id);
    return e ? { name: e.name, href: hrefOf(e), image: e.image } : null;
  };
  const ctx = { kind, category, everyone, lookup, api: entitiesApi(kind) };
  if (item) return detail(root, item, ctx);
  list(root, ctx, everyone.filter((e) => e.kind === kind && (!category || e.category === category.id)));
  return {};
}

// --- list ------------------------------------------------------------------------------------

/** What a list or page is called: "NPCs", "Rumors", "Items". */
const titleOf = (kind, category) => (category ? plural(category.label) : kindOf(kind).label);

function list(root, { kind, category }, all) {
  // Items: filter chips for the rarities in use, remembered per project.
  const filterKey = `tempest.${currentProjectId()}.items.rarity`;
  const rarities = kind === 'items' ? [...new Map(all.filter((e) => e.rarity).map((e) => [e.rarity.id, e.rarity])).values()] : [];
  let only = rarities.some((r) => r.id === store.get(filterKey)) ? store.get(filterKey) : '';
  const entries = only ? all.filter((e) => e.rarity?.id === only) : all;
  // Stories read best in time order; characters by name (the server's order).
  if (kind === 'stories') {
    entries.sort((a, b) => (a.start ? (b.start ? a.start.y - b.start.y || (a.start.m ?? 0) - (b.start.m ?? 0) || (a.start.d ?? 0) - (b.start.d ?? 0) : -1) : b.start ? 1 : 0));
  }
  const forgeLink = el('a', { class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', href: `#/forge/${kind}` }, 'Create in The Forge');
  const field = kindOf(kind).defaults.find((d) => d.id === 'category')?.label; // Category / Type (items: none)
  root.replaceChildren(
    el('div', { class: 'cv' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${entries.length} ${category ? (entries.length === 1 ? category.label : plural(category.label)) : entries.length === 1 ? 'item' : 'items'}`),
        el('span', { class: 'app-actions' },
          all.length ? pushButton('Push list', () => push({ mode: 'roster', kind, category: category?.id ?? null }), { title: `Show every ${category ? category.label : 'item'} on the player screen (names, pictures and summaries, as each sheet allows)` }) : null,
          forgeLink)),
      rarities.length > 1
        ? el('div', { class: 'cv-filters', role: 'group', 'aria-label': 'Filter by rarity' },
            el('button', { type: 'button', class: `fd-seg__btn ${only ? '' : 'is-on'}`, 'aria-pressed': String(!only), onClick: () => (store.set(filterKey, ''), list(root, { kind, category }, all)) }, 'All'),
            rarities.map((r) => el('button', { type: 'button', class: `cv-filter ${only === r.id ? 'is-on' : ''}`, 'aria-pressed': String(only === r.id), onClick: () => (store.set(filterKey, only === r.id ? '' : r.id), list(root, { kind, category }, all)) }, rarityBadge(r))))
        : null,
      entries.length
        ? el('ul', { class: 'cv-grid' },
            entries.map((e) =>
              el('li', {},
                el('a', { class: 'tp-frame tp-panel cv-card', href: hrefOf(e) },
                  e.image ? el('img', { class: 'cv-card__image', src: imageUrl(e.image), alt: '', loading: 'lazy' }) : el('span', { class: 'cv-card__image cv-card__sigil', 'aria-hidden': 'true' }, initials(e.name)),
                  el('span', { class: 'cv-card__text' },
                    el('span', { class: 'cv-card__name' }, e.name),
                    el('span', { class: `tp-dim cv-card__meta ${kind === 'stories' ? 'tp-mono' : ''}` }, meta(e)),
                    e.summary ? el('span', { class: 'cv-card__summary' }, e.summary) : null,
                    e.presetName ? el('span', { class: 'tp-dim cv-card__preset' }, e.presetName) : null)))))
        : el('article', { class: 'tp-frame tp-panel app-placeholder' },
            el('div', { class: 'tp-panel__body' },
              el('p', { class: 'tp-h3' }, `No ${titleOf(kind, category)} yet`),
              el('p', { class: 'tp-muted' }, category
                ? `Build a ${kindOf(kind).label} preset in The Forge, set its ${field} to ${category.label}, and use Create New at the bottom.`
                : `Build an Items preset in The Forge and use Create New at the bottom.`),
              forgeLink.cloneNode(true)))),
  );
}

// --- one entry ------------------------------------------------------------------------------

async function detail(root, id, { kind, category, everyone, lookup, api }) {
  const back = category ? `#/${kindOf(kind).section}/${category.tab}` : `#/${kindOf(kind).section}`;
  let e;
  try {
    e = await api.get(id);
  } catch (err) {
    root.replaceChildren(el('article', { class: 'tp-frame tp-panel app-placeholder' },
      el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-h3' }, 'Not found'), el('p', { class: 'tp-muted' }, err.message),
        el('a', { class: 'tp-frame tp-btn', href: back }, `All ${titleOf(kind, category)}`))));
    return {};
  }
  // Its category says it lives on another tab (e.g. it was moved): go there.
  if (category && e.category !== category.id) {
    location.replace(hrefOf(e));
    return {};
  }

  let view = 'gm';
  let editing = null; // { state, form, onChange } while editing

  const sheetOf = (values = e.values, shown = e.shown, refs = e.refs) =>
    renderSheet(e.sheet, {
      view, values, shown, refs, lookup, imageUrl,
      pushImage: (image, caption) => push({ mode: 'handout', image, caption }),
      openImage: (items, index) => openImage(items.map((x) => ({ ...x, src: imageUrl(x.image) })), index, { push: (x) => push({ mode: 'handout', image: x.image, caption: x.caption }) }),
    });

  function render() {
    const seg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'View as' },
      [['gm', 'GM view'], ['player', 'Player view']].map(([v, label]) =>
        el('button', { type: 'button', class: `fd-seg__btn ${view === v ? 'is-on' : ''}`, 'aria-pressed': String(view === v), onClick: () => ((view = v), render()) }, label)));
    const preview = el('div', { class: 'tp-panel__body' }, sheetOf(...(editing ? [editing.state.values, editing.state.shown, editing.state.refs] : [])));
    root.replaceChildren(
      el('div', { class: 'cv' },
        el('div', { class: 'cv-bar' },
          el('a', { class: 'app-link', href: back }, `← All ${titleOf(kind, category)}`),
          el('span', { class: 'app-actions' },
            seg,
            editing ? null : pushButton('Push', () => push({ mode: 'entity', id: e.id }), { title: 'Show this entry on the player screen, as the Player view shows it' }),
            editing ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: startEdit }, 'Edit'),
            editing ? null : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: remove }, 'Delete'))),
        editing
          ? el('section', { class: 'tp-frame tp-panel fd-create' },
              el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, `Editing ${e.name}`), el('span', { class: 'tp-dim' }, 'The sheet below follows along.')),
              el('div', { class: 'tp-panel__body' },
                editing.form.node,
                el('div', { class: 'fd-create__foot' },
                  el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => ((editing = null), render()) }, 'Cancel'),
                  el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: save }, 'Save'))))
          : null,
        el('article', { class: 'tp-frame tp-panel cv-sheet' }, preview),
        el('p', { class: 'tp-dim cv-foot' }, `Forged from ${e.presetName ? `"${e.presetName}"` : 'a preset'} · updated ${new Date(e.updatedAt).toLocaleString()}`)),
    );
    // Typing in the form updates only the sheet, so focus stays in the form.
    if (editing) editing.onChange = () => preview.replaceChildren(sheetOf(editing.state.values, editing.state.shown, editing.state.refs));
  }

  function startEdit() {
    const state = structuredClone({ values: e.values, shown: e.shown, refs: e.refs });
    editing = { state, onChange: null };
    editing.form = valuesForm({ sheet: e.sheet, state, candidates: everyone, selfId: e.id, onChange: () => editing?.onChange?.() });
    render();
    root.querySelector('[data-key="v:name"]')?.focus();
  }

  async function save() {
    try {
      const next = normalizeEntity({ ...e, ...editing.state }, { kind });
      e = await api.save(next);
      editing = null;
      toast(`Saved "${e.name}"`, { tone: 'success' });
      if (category && e.category !== category.id) {
        toast(`Moved to ${plural(categoryOf(kind, e.category).label)}`);
        location.hash = hrefOf(e);
        return;
      }
      render();
    } catch (err) {
      toastError(err);
    }
  }

  async function remove() {
    if (!(await confirmDialog({ title: `Delete ${e.name}?`, body: `This ${kindOf(kind).entity} will be deleted for good.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.remove(e.id);
      toast(`Deleted "${e.name}"`);
      location.hash = back;
    } catch (err) {
      toastError(err);
    }
  }

  render();
  document.title = `TEMPEST · ${e.name}`;
  return {};
}
