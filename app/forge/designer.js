// The Forge › Characters/Creatures, › Stories/Rumors/Events and › Items: the preset designer.
// One module serves every kind of preset (see KINDS in preset-model.js); the
// kind decides the default fields, what can be added, and where Create New files
// the result (Characters tabs, World › Events/Stories/Rumors, or Items).
//
// A preset is the GM's own template for a character sheet. The five default
// fields sit at the top of the main section and can't be removed; Parent,
// Long Description, Image, Gallery and Stat fields can be added to the main
// section or to lower Sections (each split into 1–3 Columns), dragged into
// place, and configured in the inspector: name, type options, location,
// Revealed/Shown/Rumored, GM references and a default value. The preview shows
// the sheet as the GM sees it and as players will.
//
// Create New, at the bottom, makes it a one-stop shop: fill in the form built
// from the preset (the preview follows along) and the result is saved as a
// character under Characters › Players/NPCs/Monsters/Creatures, by its Category.
//
// Presets are saved on the server (one JSON file each), exported as files, and
// imported from files. Work in progress is kept in this browser as a draft, so
// leaving the page or closing the window loses nothing.

import { el, store, toast, toastError, confirmDialog, download, menuButton } from '../ui.js';
import { presetsApi, entitiesApi, allEntities, imageUrl, currentProjectId } from '../api.js';
import * as M from './preset-model.js';
import { renderSheet, rarityBadge } from './sheet.js';
import { valuesForm } from './values-form.js';
import { forge, defaultValues, categoryOf, hrefOf, plural } from './entity-model.js';
import { templatesFor } from './templates/index.js';

// Kept per project: each project has its own draft and last-opened preset.
const DRAFT_KEY = () => `tempest.${currentProjectId()}.forge.${KIND}.draft`;
const LAST_KEY = () => `tempest.${currentProjectId()}.forge.${KIND}.last`;
let KIND = 'characters'; // the kind being designed (set by mount)
const MODE_KEY = () => `tempest.forge.${KIND}.mode`;
/**
 * "+ New NPC" on a list (app/entities/view.js): open The Forge on Create New, with the
 * Category (or Type) already set. Read once by the next mount of that kind.
 */
let pending = null;
export function startNew(kind, category = null) {
  pending = { kind, category };
}

const MODES = [
  { id: 'create', label: 'Create New', hint: 'Fill in a new entry from this preset, with the sheet beside the form' },
  { id: 'design', label: 'Design', hint: 'Add, arrange and set up the preset\'s fields' },
  { id: 'preview', label: 'Preview', hint: 'The whole sheet, as the GM or the players see it' },
];
/** Presets with more sections than this open with their sections folded. */
const FOLD_OVER = 5;
const TYPE_ICON = { rarity: '✦', category: '◈', image: '▣', text: 'T', size: '⇕', shorttext: '¶', date: '◷', parent: '↑', longtext: '≡', gallery: '▦', stat: '◧', statblock: '▤', cast: '⚔', location: '⌖', relations: '⇄' };

/**
 * mount(root, { tab, kind, onCreated, entry })
 *   entry   edit one entry's own sheet instead of a preset (the entry's page, "Edit fields"):
 *           { name, presetName, sheet: { fields, layout }, values, shown, refs, onSave(sheet), onCancel() }.
 *           The same builder and field settings, a preview with the entry's own values, and
 *           Save fields / Cancel instead of the preset library. Presets and drafts are untouched.
 */
export async function mount(root, { tab, kind, onCreated = null, entry = null } = {}) {
  // The Forge's tabs name their kind; Combat › Netrunning › Card Forge passes kind: 'netcards'.
  KIND = M.PRESET_KINDS.includes(kind) ? kind : ['stories', 'items', 'factions'].includes(tab?.id) ? tab.id : 'characters';
  const api = presetsApi(KIND);
  const entities = entitiesApi(KIND);
  const NEW_NAME = `New ${M.kindOf(KIND).entity} preset`;
  const ENTITY = M.kindOf(KIND).entity; // 'character' | 'story'
  const s = {
    preset: null, // the working copy
    saved: null, // JSON of the last saved/loaded version ('' = never saved)
    isNew: true, // not on the server yet
    selected: 'name',
    target: { area: 'main' }, // where "Add" puts new fields
    view: 'gm',
    library: [],
    dragging: null,
    // Create New: what's filled in so far. Untouched fields follow the preset's defaults.
    forging: null,
    people: [], // the project's entities of every kind, for Parent, References, Characters and Location pickers
    // Which part of the page shows: 'create' (form + live preview), 'design' (builder + field settings)
    // or 'preview' (the whole sheet). Remembered per kind.
    mode: MODES.some((m) => m.id === store.get(MODE_KEY())) ? store.get(MODE_KEY()) : 'create',
    collapsed: new Set(), // builder sections folded away (ids)
  };
  // Arrived from "+ New NPC" (startNew): every fresh form starts with that Category, until the page is left.
  const asked = pending?.kind === KIND && !entry ? pending.category : null;
  if (pending?.kind === KIND) {
    pending = null;
    if (!entry) s.mode = 'create';
  }
  const freshForging = (preset) => {
    const values = defaultValues(preset);
    const touched = new Set();
    if (asked && preset.fields.category) {
      values.category = asked;
      touched.add('category');
    }
    return { values, shown: {}, refs: {}, touched };
  };
  // Editing an entry's sheet: the preview shows the entry's own values.
  const entryForging = () => ({ values: structuredClone(entry.values ?? {}), shown: structuredClone(entry.shown ?? {}), refs: structuredClone(entry.refs ?? {}), touched: new Set() });

  const dirty = () => JSON.stringify(s.preset) !== s.saved;
  // An entry's sheet is never a preset draft: editing it leaves the Forge's own work alone.
  const persistDraft = () => (entry ? null : store.set(DRAFT_KEY(), JSON.stringify({ preset: s.preset, saved: s.saved, isNew: s.isNew })));

  // --- state changes ----------------------------------------------------------------------

  function change(next, { inspector = true } = {}) {
    s.preset = next;
    persistDraft();
    if (!s.preset.fields[s.selected]) s.selected = 'name';
    renderToolbar();
    renderBuilder();
    if (inspector) renderInspector();
    form?.refresh(s.preset);
    renderPreview();
  }

  function attempt(fn) {
    try {
      return fn();
    } catch (err) {
      toastError(err);
      return null;
    }
  }

  function load(input, { isNew = false } = {}) {
    // Presets saved by earlier versions gain any default fields added since (e.g. Category).
    const preset = attempt(() => M.normalizePreset(input)) ?? M.newPreset(NEW_NAME, KIND);
    s.preset = preset;
    s.saved = isNew ? '' : JSON.stringify(preset);
    s.isNew = isNew;
    s.selected = 'name';
    s.target = { area: 'main' };
    s.forging = entry ? entryForging() : freshForging(preset);
    s.collapsed = foldedFor(preset);
    form = null;
    if (!isNew && !entry) store.set(LAST_KEY(), preset.id);
    persistDraft();
    renderAll();
  }

  /** Long presets open with their sections folded, so the builder fits on a screen or two. */
  const foldedFor = (preset) => new Set(preset.layout.sections.length > FOLD_OVER ? preset.layout.sections.map((x) => x.id) : []);

  async function refreshLibrary() {
    s.library = await api.list().catch((err) => (toastError(err), s.library));
  }

  /** Ask before throwing away unsaved work. */
  async function canLeave() {
    if (!dirty()) return true;
    return confirmDialog({ title: 'Discard unsaved changes?', body: `"${s.preset.name}" has changes that aren't saved.`, confirmLabel: 'Discard', danger: true });
  }

  // --- actions --------------------------------------------------------------------------

  async function save() {
    let clean;
    try {
      clean = M.normalizePreset(s.preset);
    } catch (err) {
      return toastError(err);
    }
    if (entry) {
      // The entry's page saves it (and asks first if any filled-in values would be lost).
      const done = await entry.onSave({ fields: clean.fields, layout: clean.layout });
      if (done) s.saved = JSON.stringify(s.preset);
      renderToolbar();
      return;
    }
    try {
      const out = s.isNew ? await api.create(clean) : await api.save(clean);
      await refreshLibrary();
      load(out);
      toast(`Saved "${out.name}"`, { tone: 'success' });
    } catch (err) {
      toastError(err);
    }
  }

  async function openPreset(id) {
    if (id === s.preset.id || !(await canLeave())) return renderToolbar();
    try {
      load(await api.get(id));
    } catch (err) {
      toastError(err);
      renderToolbar();
    }
  }

  async function newPreset() {
    if (!(await canLeave())) return;
    load(M.newPreset(NEW_NAME, KIND), { isNew: true });
  }

  /** Start an unsaved preset from a ready-made template (app/forge/templates/). */
  async function fromTemplate(templateId) {
    const template = templatesFor(KIND).find((t) => t.id === templateId);
    if (!template || !(await canLeave())) return renderToolbar();
    const preset = template.build();
    preset.id = M.newId('preset');
    load(preset, { isNew: true });
    toast(`Started from "${template.name}". Save it to keep it.`);
  }

  async function duplicate() {
    if (!(await canLeave())) return;
    const copy = structuredClone(s.preset);
    copy.id = M.newId('preset');
    copy.name = `${s.preset.name} (copy)`.slice(0, 80);
    load(copy, { isNew: true });
  }

  async function remove() {
    if (s.isNew) {
      if (await confirmDialog({ title: 'Discard this preset?', body: `"${s.preset.name}" was never saved.`, confirmLabel: 'Discard', danger: true })) await openFirst(true);
      return;
    }
    if (!(await confirmDialog({ title: 'Delete preset?', body: `"${s.preset.name}" will be deleted for good. Export it first if you might want it back.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.remove(s.preset.id);
      toast(`Deleted "${s.preset.name}"`);
      await openFirst(true);
    } catch (err) {
      toastError(err);
    }
  }

  function exportPreset() {
    const clean = attempt(() => M.normalizePreset(s.preset));
    if (!clean) return;
    const slug = clean.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
    download(`${slug}.tempest-preset.json`, `${JSON.stringify(clean, null, 2)}\n`);
  }

  function importPreset() {
    const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file || !(await canLeave())) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('That file is too large to be a preset');
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch {
          throw new Error(`"${file.name}" isn't a JSON file`);
        }
        const out = await api.create(data); // the server checks it and gives it a fresh id
        await refreshLibrary();
        load(out);
        toast(`Imported "${out.name}"`, { tone: 'success' });
      } catch (err) {
        toastError(err);
      }
    });
    document.body.append(input);
    input.click();
  }

  async function openFirst(force = false) {
    await refreshLibrary();
    const last = store.get(LAST_KEY());
    const pick = s.library.find((p) => p.id === last) ?? s.library[0];
    if (pick && (force || !s.preset)) {
      try {
        return load(await api.get(pick.id));
      } catch {
        /* fall through to a new preset */
      }
    }
    load(M.newPreset(NEW_NAME, KIND), { isNew: true });
  }

  // --- layout -------------------------------------------------------------------------------

  const toolbar = el('div', { class: 'tp-frame tp-panel fd-toolbar' });
  const modeBar = el('nav', { class: 'tp-tabs fd-modes', role: 'tablist', 'aria-label': 'The Forge' });
  const builder = el('div', { class: 'fd-builder' });
  const inspector = el('aside', { class: 'tp-frame tp-panel fd-inspector', 'aria-label': 'Field settings' });
  const preview = el('section', { class: 'tp-frame tp-panel fd-preview', 'aria-label': 'Preview' });
  const creator = el('section', { class: 'tp-frame tp-panel fd-create', 'aria-label': 'Create New' });
  const work = el('div', { class: 'fd-work', role: 'tabpanel' }, builder, inspector);
  const make = el('div', { class: 'fd-make', role: 'tabpanel' }, creator, preview);
  const page = el('div', { class: 'fd' }, toolbar, modeBar, work, make);
  root.append(page);
  let form = null; // the Create New values form

  function renderAll() {
    renderToolbar();
    renderModes();
    renderBuilder();
    renderInspector();
    renderCreator();
    renderPreview();
  }

  // --- modes: Create New · Design · Preview --------------------------------------------------

  function setMode(mode) {
    if (mode === s.mode) return;
    s.mode = mode;
    store.set(MODE_KEY(), mode);
    renderModes();
    renderToolbar(); // the preset name box comes and goes with Design
    page.scrollIntoView({ block: 'start' });
  }

  function renderModes() {
    if (entry) {
      // One page: the builder and field settings, with the entry's sheet below them.
      modeBar.hidden = true;
      work.hidden = false;
      make.hidden = false;
      creator.hidden = true;
      make.classList.add('fd-make--preview');
      return;
    }
    modeBar.replaceChildren(...MODES.map((m) =>
      el('button', {
        type: 'button', role: 'tab', class: 'tp-tab fd-modes__tab', title: m.hint,
        'aria-selected': String(s.mode === m.id), tabindex: s.mode === m.id ? '0' : '-1',
        onClick: () => setMode(m.id),
        onKeydown: (e) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!step) return;
          const next = MODES[(MODES.findIndex((x) => x.id === s.mode) + step + MODES.length) % MODES.length];
          setMode(next.id);
          modeBar.querySelector('[aria-selected="true"]')?.focus();
        },
      }, m.label)));
    work.hidden = s.mode !== 'design';
    make.hidden = s.mode === 'design';
    creator.hidden = s.mode !== 'create';
    make.classList.toggle('fd-make--preview', s.mode === 'preview');
  }

  // --- toolbar: library and file actions -----------------------------------------------------

  function renderToolbar() {
    if (entry) {
      toolbar.replaceChildren(
        el('div', { class: 'tp-panel__body fd-toolbar__body' },
          el('div', { class: 'fd-toolbar__pick' },
            el('span', { class: 'tp-label' }, 'Fields of'),
            el('strong', { class: 'tp-h3' }, entry.name)),
          el('span', { class: 'tp-dim fd-toolbar__note' }, `Changes apply to this ${ENTITY} only${entry.presetName ? `, not to the "${entry.presetName}" preset or anything else made from it` : ''}.`),
          el('span', { class: `fd-status ${dirty() ? 'is-dirty' : ''}`, role: 'status' }, dirty() ? 'Unsaved changes' : 'Saved'),
          el('div', { class: 'app-actions fd-toolbar__actions' },
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: save, disabled: !dirty(), title: 'Save (Ctrl+S)' }, 'Save fields'),
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--ghost',
              onClick: async () => {
                if (dirty() && !(await confirmDialog({ title: 'Discard these changes?', body: `The changes to ${entry.name}'s fields aren't saved.`, confirmLabel: 'Discard', danger: true }))) return;
                entry.onCancel();
              },
            }, dirty() ? 'Cancel' : 'Done'))));
      return;
    }
    const options = s.library.map((p) => el('option', { value: p.id, selected: p.id === s.preset.id }, p.name));
    if (s.isNew) options.unshift(el('option', { value: s.preset.id, selected: true }, `${s.preset.name} (not saved yet)`));
    // Renaming is part of designing: the name box shows in Design, or while a new preset is unnamed work.
    const naming = s.mode === 'design' || s.isNew;
    toolbar.replaceChildren(
      el('div', { class: 'tp-panel__body fd-toolbar__body' },
        el('label', { class: 'tp-field fd-toolbar__pick' },
          el('span', { class: 'tp-label' }, `Preset (${s.library.length} saved)`),
          el('select', { class: 'tp-select', 'aria-label': 'Open a preset', onChange: (e) => openPreset(e.target.value) }, options)),
        naming
          ? el('label', { class: 'tp-field fd-toolbar__name' },
              el('span', { class: 'tp-label' }, 'Preset name'),
              el('input', {
                class: 'tp-input', value: s.preset.name, maxlength: 80, 'data-key': 'preset-name',
                onInput: (e) => change({ ...s.preset, name: e.target.value }, { inspector: false }),
              }))
          : null,
        el('span', { class: `fd-status ${dirty() ? 'is-dirty' : ''}`, role: 'status' }, s.isNew ? 'Not saved yet' : dirty() ? 'Unsaved changes' : 'Saved'),
        el('div', { class: 'app-actions fd-toolbar__actions' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: save, disabled: !dirty() && !s.isNew, title: 'Save the preset (Ctrl+S)' }, 'Save'),
          presetMenu())));
    restoreFocus(toolbar); // keep typing in the name box after the redraw
  }

  /** New, templates, Duplicate, Import, Export and Delete: one menu beside Save. */
  function presetMenu() {
    const item = (label, run, { hint = null, title = null, danger = false } = {}) =>
      el('button', { type: 'button', class: `app-menu__item ${danger ? 'app-menu__item--danger' : ''}`, title, onClick: run }, label, hint ? el('span', { class: 'tp-dim' }, hint) : null);
    const templates = templatesFor(KIND);
    const menu = menuButton('Preset ⋯', () => [
      item('New blank preset', newPreset),
      templates.length
        ? el('label', { class: 'app-menu__field' },
            el('span', { class: 'tp-label' }, 'New from a template'),
            el('select', {
              class: 'tp-select', 'aria-label': 'Start a new preset from a template',
              onChange: (e) => (menu.close(), fromTemplate(e.target.value)),
            },
            el('option', { value: '', selected: true }, 'Choose one…'),
            templates.map((t) => el('option', { value: t.id, title: t.description }, t.name))))
        : null,
      item('Duplicate', duplicate, { title: 'A copy of this preset to change' }),
      el('div', { class: 'app-menu__sep', role: 'separator' }),
      item('Import…', importPreset, { hint: '.json', title: 'Load a preset from a .json file' }),
      item('Export', exportPreset, { hint: '.json', title: 'Save this preset as a .json file to share or back up' }),
      el('div', { class: 'app-menu__sep', role: 'separator' }),
      item(s.isNew ? 'Discard this preset' : 'Delete this preset…', remove, { danger: true }),
    ], { title: 'New, template, duplicate, import, export or delete presets' });
    return menu.node;
  }

  // --- builder: main section, lower sections, add palette ---------------------------------------

  const sameTarget = (a, b) => a.area === b.area && (a.area === 'main' || (a.section === b.section && a.column === b.column));

  function chip(id) {
    const f = s.preset.fields[id];
    const fixed = M.defaultIdsOf(KIND).includes(id);
    const at = M.locate(s.preset, id);
    const listLength = fixed ? 0 : at.area === 'main' ? s.preset.layout.main.length : s.preset.layout.sections.find((x) => x.id === at.section).columns[at.column].length;
    const vis = f.visibility !== 'revealed' ? el('span', { class: `fd-chip__vis fd-chip__vis--${f.visibility}` }, ({ shown: 'Shown', hidden: 'Hidden' })[f.visibility] ?? 'Rumored') : null;
    return el('li', {
      class: `fd-chip ${s.selected === id ? 'is-selected' : ''} ${fixed ? 'is-fixed' : ''} ${s.dragging === id ? 'is-dragging' : ''}`,
      'data-id': id, draggable: fixed ? null : 'true',
      onDragstart: (e) => {
        s.dragging = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        requestAnimationFrame(() => e.target.classList.add('is-dragging'));
      },
      onDragend: () => {
        s.dragging = null;
        renderBuilder();
      },
    },
      el('span', { class: 'fd-chip__grip', 'aria-hidden': 'true' }, fixed ? '🔒︎' : '⋮⋮'),
      el('button', { type: 'button', class: 'fd-chip__pick', onClick: () => select(id), 'aria-pressed': String(s.selected === id) },
        el('span', { class: 'fd-chip__icon', 'aria-hidden': 'true' }, TYPE_ICON[f.type] ?? '•'),
        el('span', { class: 'fd-chip__label' }, f.label),
        el('span', { class: 'fd-chip__type' }, M.TYPE_LABELS[f.type]),
        vis,
        f.references ? el('span', { class: 'fd-chip__vis fd-chip__vis--refs', title: 'GM references' }, 'Refs') : null),
      fixed
        ? null
        : el('span', { class: 'fd-chip__tools' },
            el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': `Move ${f.label} up`, disabled: at.index === 0, onClick: () => change(M.nudgeField(s.preset, id, -1)) }, '▲'),
            el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': `Move ${f.label} down`, disabled: at.index >= listLength - 1, onClick: () => change(M.nudgeField(s.preset, id, 1)) }, '▼'),
            el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove ${f.label}`, onClick: () => removeField(id) }, '×')));
  }

  /** A list fields can be dropped into; clicking it makes it where "Add" puts new fields. */
  function dropList(target, ids, emptyText) {
    const active = sameTarget(s.target, target);
    const list = el('ul', {
      class: `fd-list ${active ? 'is-target' : ''}`,
      onClick: (e) => {
        if (e.target.closest('button, .fd-chip')) return;
        s.target = target;
        renderBuilder();
      },
      onDragover: (e) => {
        if (!s.dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const index = dropIndex(list, e.clientY);
        list.querySelectorAll('.is-drop-before').forEach((n) => n.classList.remove('is-drop-before'));
        list.classList.toggle('is-drop-end', index === list.querySelectorAll(':scope > .fd-chip').length);
        list.querySelectorAll(':scope > .fd-chip')[index]?.classList.add('is-drop-before');
        list.classList.add('is-drop');
      },
      onDragleave: (e) => {
        if (!list.contains(e.relatedTarget)) clearDrop(list);
      },
      onDrop: (e) => {
        e.preventDefault();
        const id = s.dragging ?? e.dataTransfer.getData('text/plain');
        const index = dropIndex(list, e.clientY);
        clearDrop(list);
        s.dragging = null;
        if (s.preset.fields[id]) change(M.moveField(s.preset, id, target, index));
      },
    },
      ids.map(chip),
      ids.length ? null : el('li', { class: 'fd-list__empty' }, emptyText));
    return list;
  }

  const clearDrop = (list) => {
    list.classList.remove('is-drop', 'is-drop-end');
    list.querySelectorAll('.is-drop-before').forEach((n) => n.classList.remove('is-drop-before'));
  };

  function dropIndex(list, y) {
    const chips = [...list.querySelectorAll(':scope > .fd-chip:not(.is-fixed)')];
    const i = chips.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? chips.length : i;
  }

  function targetName(t) {
    if (t.area === 'main') return 'Main section';
    const sec = s.preset.layout.sections.find((x) => x.id === t.section);
    if (!sec) return 'Main section';
    const name = sec.title || 'Untitled section';
    return sec.layout === 'body' || sec.columns.length > 1 ? `${name}, ${M.columnLabel(sec, t.column).toLowerCase()}` : name;
  }

  function addField(type) {
    const target = s.preset.layout.sections.some((x) => x.id === s.target.section) || s.target.area === 'main' ? s.target : { area: 'main' };
    const out = attempt(() => M.addField(s.preset, type, target));
    if (!out) return;
    s.selected = out.id;
    change(out.preset);
    inspector.querySelector('[data-key="label"]')?.focus();
  }

  function addSection() {
    const out = attempt(() => M.addSection(s.preset, `Section ${s.preset.layout.sections.length + 1}`));
    if (!out) return;
    s.target = { area: 'section', section: out.id, column: 0 };
    s.collapsed.delete(out.id);
    change(out.preset);
    builder.querySelector(`[data-section="${out.id}"] input`)?.select();
  }

  async function removeField(id) {
    const f = s.preset.fields[id];
    change(M.removeField(s.preset, id));
    toast(`Removed "${f.label}"`);
  }

  function toggleFold(sectionId) {
    if (!s.collapsed.delete(sectionId)) s.collapsed.add(sectionId);
    renderBuilder();
  }

  function fold(all) {
    s.collapsed = new Set(all ? s.preset.layout.sections.map((x) => x.id) : []);
    renderBuilder();
  }

  async function removeSection(sec) {
    const n = sec.columns.flat().length;
    if (n && !(await confirmDialog({ title: 'Remove section?', body: `"${sec.title || 'Untitled section'}" and the ${n} field${n === 1 ? '' : 's'} in it will be removed.`, confirmLabel: 'Remove', danger: true }))) return;
    if (s.target.section === sec.id) s.target = { area: 'main' };
    change(M.removeSection(s.preset, sec.id));
  }

  function renderBuilder() {
    const p = s.preset;
    // replaceChildren() doesn't flatten arrays or skip nulls: do both here.
    builder.replaceChildren(...[
      el('div', { class: 'tp-frame tp-panel fd-palette' },
        el('div', { class: 'tp-panel__body fd-palette__body' },
          el('span', { class: 'tp-label' }, 'Add'),
          M.addableOf(KIND).map((a) => el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', title: a.hint, onClick: () => addField(a.type) }, `+ ${a.label}`)),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', title: 'A new lower section; split it into up to three columns', onClick: addSection }, '+ Section'),
          el('span', { class: 'fd-palette__to tp-dim' }, 'to ', el('strong', {}, targetName(s.target)), ' · click a list to choose where'),
          p.layout.sections.length
            ? el('span', { class: 'fd-palette__fold' },
              el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => fold(true), disabled: s.collapsed.size === p.layout.sections.length }, 'Fold all'),
              el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => fold(false), disabled: !s.collapsed.size }, 'Unfold all'))
            : null)),
      el('div', { class: 'tp-frame tp-panel fd-area fd-area--main' },
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Main section'), el('span', { class: 'tp-dim' }, 'Always at the top')),
        el('div', { class: 'tp-panel__body' },
          el('ul', { class: 'fd-list fd-list--fixed' }, M.defaultIdsOf(KIND).map(chip)),
          dropList({ area: 'main' }, p.layout.main, 'Fields added here appear under the defaults.'))),
      p.layout.sections.map((sec, i) => {
        const folded = s.collapsed.has(sec.id);
        const count = sec.columns.flat().length;
        return el('div', { class: `tp-frame tp-panel fd-area ${folded ? 'is-folded' : ''}`, 'data-section': sec.id },
          el('header', { class: 'tp-panel__head fd-area__head' },
            el('button', {
              type: 'button', class: 'fd-icon-btn fd-area__fold', 'aria-expanded': String(!folded),
              'aria-label': `${folded ? 'Unfold' : 'Fold'} ${sec.title || 'untitled section'}`, onClick: () => toggleFold(sec.id),
            }, folded ? '▸' : '▾'),
            el('input', {
              class: 'tp-input fd-area__title', value: sec.title, placeholder: 'Untitled section', maxlength: 60, 'aria-label': 'Section title', 'data-key': `section:${sec.id}`,
              onInput: (e) => change(M.updateSection(s.preset, sec.id, { title: e.target.value })),
            }),
            folded ? el('button', { type: 'button', class: 'fd-area__count tp-dim', onClick: () => toggleFold(sec.id) }, `${count} field${count === 1 ? '' : 's'}${sec.layout === 'body' ? ' · body diagram' : ''}`) : null,
            folded ? null : el('label', { class: 'fd-area__cols' },
              el('span', { class: 'tp-label' }, 'Layout'),
              el('select', {
                class: 'tp-select fd-area__layout', 'aria-label': 'Section layout',
                onChange: (e) => change(M.setSectionLayout(s.preset, sec.id, e.target.value)),
              }, M.SECTION_LAYOUTS.map((l) => el('option', { value: l.id, selected: (sec.layout ?? 'columns') === l.id, title: l.hint }, l.label)))),
            folded || sec.layout === 'body' ? null : el('label', { class: 'fd-area__cols' },
              el('span', { class: 'tp-label' }, 'Columns'),
              el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Columns' },
                [1, 2, 3].map((n) => el('button', { type: 'button', class: `fd-seg__btn ${sec.columns.length === n ? 'is-on' : ''}`, 'aria-pressed': String(sec.columns.length === n), onClick: () => change(M.setColumns(s.preset, sec.id, n)) }, n)))),
            el('span', { class: 'fd-area__tools' },
              el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move section up', disabled: i === 0, onClick: () => change(M.moveSection(s.preset, sec.id, -1)) }, '▲'),
              el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move section down', disabled: i === p.layout.sections.length - 1, onClick: () => change(M.moveSection(s.preset, sec.id, 1)) }, '▼'),
              el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': 'Remove section', onClick: () => removeSection(sec) }, '×'))),
          folded ? null
          : sec.layout === 'body'
            // The five zones, laid out roughly where they sit around the figure.
            ? el('div', { class: 'tp-panel__body fd-body' },
              M.BODY_ZONES.map((z, c) => el('div', { class: `fd-body__zone fd-body__zone--${z.id}` },
                el('span', { class: 'tp-label' }, z.label),
                dropList({ area: 'section', section: sec.id, column: c }, sec.columns[c], 'Drop or add fields here'))))
            : el('div', { class: `tp-panel__body fd-columns fd-columns--${sec.columns.length}` },
              sec.columns.map((col, c) => dropList({ area: 'section', section: sec.id, column: c }, col, sec.columns.length > 1 ? `Column ${c + 1}: drop or add fields` : 'Drop or add fields here'))));
      }),
      p.layout.sections.length ? null : el('p', { class: 'tp-muted fd-hint' }, 'Add a Section for anything that belongs below the main section, such as stats, gear or lore.'),
    ].flat().filter(Boolean));
    restoreFocus(builder);
  }

  // --- inspector -------------------------------------------------------------------------------

  function select(id) {
    s.selected = id;
    renderBuilder();
    renderInspector();
  }

  const set = (patch, opts) => change(M.updateField(s.preset, s.selected, patch), opts);

  const field = (label, control, hint) => el('label', { class: 'tp-field fd-field' }, el('span', { class: 'tp-label' }, label), control, hint ? el('span', { class: 'fd-field__hint tp-dim' }, hint) : null);

  function radios(name, options, value, onPick) {
    return el('div', { class: 'fd-radios', role: 'radiogroup' },
      options.map((o) =>
        el('label', { class: `fd-radio ${value === o.id ? 'is-on' : ''}` },
          el('input', { type: 'radio', name, value: o.id, checked: value === o.id, onChange: () => onPick(o.id) }),
          el('span', { class: 'fd-radio__label' }, o.label),
          o.hint ? el('span', { class: 'fd-radio__hint tp-dim' }, o.hint) : null)));
  }

  function locationSelect(f) {
    if (M.defaultIdsOf(KIND).includes(f.id)) return el('p', { class: 'tp-dim fd-static' }, 'Main section (fixed)');
    const at = M.locate(s.preset, f.id);
    const options = [{ value: 'main', label: 'Main section', target: { area: 'main' } }];
    for (const sec of s.preset.layout.sections) {
      sec.columns.forEach((_, c) => options.push({
        value: `${sec.id}:${c}`, label: sec.layout === 'body' || sec.columns.length > 1 ? `${sec.title || 'Untitled section'} › ${M.columnLabel(sec, c)}` : sec.title || 'Untitled section',
        target: { area: 'section', section: sec.id, column: c },
      }));
    }
    const current = at.area === 'main' ? 'main' : `${at.section}:${at.column}`;
    return el('select', {
      class: 'tp-select', 'aria-label': 'Location',
      onChange: (e) => {
        const target = options.find((o) => o.value === e.target.value).target;
        if (target.section) s.collapsed.delete(target.section); // show where the field went
        change(M.moveField(s.preset, f.id, target));
      },
    }, options.map((o) => el('option', { value: o.value, selected: o.value === current }, o.label)));
  }

  function typeSettings(f) {
    switch (f.type) {
      case 'parent':
        return [field('Parent type', el('select', { class: 'tp-select', onChange: (e) => set({ parentType: e.target.value }) },
          M.PARENT_TYPES.map((t) => el('option', { value: t.id, selected: f.parentType === t.id }, t.label))), 'What kind of entry this links to')];
      case 'gallery':
        return [
          field('Gallery type', radios('gallery-mode', M.GALLERY_MODES, f.mode, (mode) => set({ mode }))),
          f.mode === 'slideshow'
            ? el('div', { class: 'fd-inline' },
                el('label', { class: 'fd-check' }, el('input', { type: 'checkbox', checked: f.autoplay, onChange: (e) => set({ autoplay: e.target.checked }) }), 'Moving (cycles on its own)'),
                f.autoplay ? el('label', { class: 'fd-inline' }, 'every', el('input', { class: 'tp-input fd-num', type: 'number', min: 2, max: 60, value: f.interval, onChange: (e) => set({ interval: Math.min(60, Math.max(2, Math.round(Number(e.target.value) || 5))) }) }), 'seconds') : null)
            : null,
          f.mode === 'grid' ? field(`Grid: ${f.cols} × ${f.rows}`, gridPicker(f), 'Columns × rows, up to 3 × 3') : null,
        ];
      case 'rarity':
        return [rarityEditor(f)];
      case 'cast':
        return [
          field('Characters type', radios('cast-mode', M.CAST_MODES, f.mode, (mode) => set({ mode }))),
          f.mode === 'combat' ? sidesEditor(f) : null,
        ];
      case 'location':
        return [field('Location type', radios('location-mode', M.LOCATION_MODES, f.mode, (mode) => set({ mode })))];
      case 'stat':
        return [field('Stat type', radios('stat-kind', M.STAT_KINDS, f.stat, (stat) => {
          const d = f.default ?? {};
          const next = stat === 'rarity' ? { rarity: f.rarities[0]?.id } : stat === 'fixed' ? { value: d.value ?? 0 } : { value: d.value ?? 10, max: d.max ?? 10 };
          set({ stat, default: next });
        })), f.stat === 'rarity' ? rarityEditor(f) : null];
      case 'statblock':
        return [blockStatsEditor(f)];
      default:
        return [];
    }
  }

  /** A Stat Block's stats: rename, reorder, add (up to 12) and remove. */
  function blockStatsEditor(f) {
    const now = () => s.preset.fields[f.id];
    const rename = (i, label) => set({ stats: now().stats.map((x, j) => (j === i ? { ...x, label } : x)) }, { inspector: false });
    const swap = (i, j) => {
      const stats = [...now().stats];
      [stats[i], stats[j]] = [stats[j], stats[i]];
      set({ stats });
    };
    const removeAt = (i) => {
      const cur = now();
      const gone = cur.stats[i].id;
      const { [gone]: _, ...rest } = cur.default ?? {};
      set({ stats: cur.stats.filter((_, j) => j !== i), default: rest });
    };
    return el('div', { class: 'fd-sides' },
      el('span', { class: 'tp-label' }, `Stats (${f.stats.length} of ${M.MAX_BLOCK_STATS})`),
      f.stats.map((st, i) =>
        el('div', { class: 'fd-inline' },
          el('input', { class: 'tp-input', value: st.label, maxlength: 16, 'aria-label': `Stat ${i + 1} name`, 'data-key': `bstat:${i}`, onInput: (e) => rename(i, e.target.value) }),
          el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': `Move ${st.label} left`, disabled: i === 0, onClick: () => swap(i, i - 1) }, '←'),
          el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': `Move ${st.label} right`, disabled: i === f.stats.length - 1, onClick: () => swap(i, i + 1) }, '→'),
          el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove ${st.label}`, disabled: f.stats.length < 2, onClick: () => removeAt(i) }, '×'))),
      f.stats.length < M.MAX_BLOCK_STATS
        ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => set({ stats: [...now().stats, M.newBlockStat(now())] }) }, '+ Stat')
        : null,
      el('span', { class: 'fd-field__hint tp-dim' }, 'Read left to right, like a rulebook stat line. Values are short text, so "4", "3d6" or "—" all fit.'));
  }

  /** Combat sides: 1–3, each with a starting name (renamable per story). */
  function sidesEditor(f) {
    // Read the field fresh on every change: typing doesn't redraw the inspector, so `f` goes stale.
    const now = () => s.preset.fields[f.id];
    const rename = (i, name) => set({ sides: now().sides.map((x, j) => (j === i ? name : x)) }, { inspector: false });
    return el('div', { class: 'fd-sides' },
      el('span', { class: 'tp-label' }, `Sides (${f.sides.length} of 3)`),
      f.sides.map((name, i) =>
        el('div', { class: 'fd-inline' },
          el('input', { class: 'tp-input', value: name, maxlength: 60, 'aria-label': `Side ${i + 1} name`, 'data-key': `side:${i}`, onInput: (e) => rename(i, e.target.value) }),
          el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove side ${i + 1}`, disabled: f.sides.length < 2, onClick: () => set({ sides: now().sides.filter((_, j) => j !== i) }) }, '×'))),
      f.sides.length < 3 ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => set({ sides: [...now().sides, `Side ${'ABC'[now().sides.length]}`] }) }, '+ Side') : null,
      el('span', { class: 'fd-field__hint tp-dim' }, 'Each side gets a faction (linkable once factions exist) and its fighters on every story.'));
  }

  /** Click a cell to pick the grid size (1×1 to 3×3). */
  function gridPicker(f) {
    return el('span', { class: 'fd-grid-pick', role: 'group', 'aria-label': 'Grid size' },
      [1, 2, 3].flatMap((r) => [1, 2, 3].map((c) =>
        el('button', {
          type: 'button', class: `fd-grid-pick__cell ${c <= f.cols && r <= f.rows ? 'is-on' : ''}`,
          'aria-label': `${c} × ${r}`, 'aria-pressed': String(c === f.cols && r === f.rows),
          onClick: () => set({ cols: c, rows: r }),
        }))));
  }

  function rarityEditor(f) {
    // Read the field fresh on every change: typing a name doesn't redraw the inspector, so `f` goes stale.
    const now = () => s.preset.fields[f.id];
    const update = (i, patch) => set({ rarities: now().rarities.map((r, j) => (j === i ? { ...r, ...patch } : r)) }, { inspector: !('name' in patch) });
    return el('div', { class: 'fd-rarities' },
      el('span', { class: 'tp-label' }, 'Rarities'),
      el('ul', { class: 'fd-rarities__list' },
        f.rarities.map((r, i) =>
          el('li', { class: 'fd-rarity' },
            el('input', { type: 'radio', name: 'rarity-default', checked: f.default?.rarity === r.id, 'aria-label': `Use ${r.name}`, title: 'The rarity this preset starts with', onChange: () => set({ default: { rarity: r.id } }) }),
            el('input', { class: 'tp-input', value: r.name, maxlength: 30, 'aria-label': 'Rarity name', 'data-key': `rarity:${i}`, onInput: (e) => update(i, { name: e.target.value }) }),
            el('input', { class: 'fd-color', type: 'color', value: r.color, 'aria-label': `${r.name} colour`, onChange: (e) => update(i, { color: e.target.value }) }),
            el('select', { class: 'tp-select', 'aria-label': `${r.name} style`, onChange: (e) => update(i, { style: e.target.value }) },
              M.RARITY_STYLES.map((st) => el('option', { value: st.id, selected: r.style === st.id }, st.label))),
            el('span', { class: 'fd-rarity__sample' }, rarityBadge(r)),
            el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove ${r.name}`, disabled: f.rarities.length < 2,
              onClick: () => { const cur = now(); set({ rarities: cur.rarities.filter((_, j) => j !== i), default: cur.default?.rarity === r.id ? { rarity: cur.rarities.find((_, j) => j !== i).id } : cur.default }); } }, '×')))),
      el('button', {
        type: 'button', class: 'tp-frame tp-btn tp-btn--sm', disabled: f.rarities.length >= 12,
        onClick: () => set({ rarities: [...now().rarities, { id: M.newId('r'), name: `Rarity ${now().rarities.length + 1}`, color: '#a9b1bb', style: 'plain' }] }),
      }, '+ Rarity'),
      el('span', { class: 'fd-field__hint tp-dim' }, `Define the rarities this stat can take; the selected one is what each new ${ENTITY} starts with.`));
  }

  function defaultEditor(f) {
    const d = f.default;
    switch (f.type) {
      case 'text':
      case 'shorttext':
        return field('Default text', el('input', { class: 'tp-input', value: d ?? '', maxlength: 200, 'data-key': 'default', onInput: (e) => set({ default: e.target.value }, { inspector: false }) }), `What each new ${ENTITY} starts with (optional)`);
      case 'longtext':
        return field('Default text', el('textarea', { class: 'tp-textarea', rows: 3, 'data-key': 'default', onInput: (e) => set({ default: e.target.value }, { inspector: false }) }, d ?? ''));
      case 'category':
        return field('Default category', el('select', { class: 'tp-select', onChange: (e) => set({ default: e.target.value }) },
          M.categoriesOf(KIND).map((c) => el('option', { value: c.id, selected: d === c.id }, c.label))),
        KIND === 'netcards'
          ? `Always set: what kind of node a ${ENTITY} made from this preset is in a NET architecture`
          : `Always set: it decides which ${KIND === 'stories' ? 'World' : 'Characters'} tab a ${ENTITY} made from this preset goes in`);
      case 'size':
        return field('Default size', el('select', { class: 'tp-select', onChange: (e) => set({ default: e.target.value }) }, M.SIZES.map((x) => el('option', { value: x, selected: d === x }, x))));
      case 'stat': {
        if (f.stat === 'rarity') return null;
        const num = (key, label) => el('label', { class: 'fd-inline' }, label,
          el('input', { class: 'tp-input fd-num', type: 'number', value: d?.[key] ?? 0, min: key === 'max' || f.stat === 'pool' ? 0 : null, 'data-key': `default:${key}`,
            onChange: (e) => set({ default: { ...d, [key]: Number(e.target.value) || 0 } }) }));
        return field('Default value', el('div', { class: 'fd-inline' }, num('value', 'Value'), f.stat !== 'fixed' ? num('max', 'Limit') : null),
          f.stat === 'flex' ? 'A flexible pool can go beyond its limit' : f.stat === 'pool' ? 'A pool stays within 0 and its limit' : null);
      }
      case 'statblock': {
        const cur = () => s.preset.fields[f.id].default ?? {};
        return field('Default values', el('span', { class: 'vf-block' },
          f.stats.map((st) => el('label', { class: 'vf-block__stat' },
            el('span', { class: 'tp-label' }, st.label),
            el('input', {
              class: 'tp-input vf-block__input', value: d?.[st.id] ?? '', maxlength: M.MAX_STAT_TEXT, 'data-key': `default:${st.id}`,
              onInput: (e) => {
                const next = { ...cur() };
                if (e.target.value.trim()) next[st.id] = e.target.value;
                else delete next[st.id];
                set({ default: next }, { inspector: false });
              },
            })))), `What each new ${ENTITY} starts with (optional)`);
      }
      default:
        return null;
    }
  }

  function renderInspector() {
    const f = s.preset.fields[s.selected];
    if (!f) return inspector.replaceChildren(el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-muted' }, 'Pick a field to set it up.')));
    const fixed = M.defaultIdsOf(KIND).includes(f.id);
    const nameLabel = f.type === 'image' || f.type === 'gallery' ? 'Field description' : 'Field name';
    inspector.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, f.label || M.TYPE_LABELS[f.type]),
        el('span', { class: 'tp-badge' }, fixed ? `${M.TYPE_LABELS[f.type]} · default` : M.TYPE_LABELS[f.type])),
      el('div', { class: 'tp-panel__body fd-inspector__body' },
        field(nameLabel, el('input', { class: 'tp-input', value: f.label, maxlength: 60, 'data-key': 'label', onInput: (e) => set({ label: e.target.value }, { inspector: false }) }),
          f.primary ? 'Shown square (1:1) at the top left of the sheet' : 'What everyone sees as this field\'s title'),
        typeSettings(f),
        defaultEditor(f),
        field('Location', locationSelect(f)),
        el('fieldset', { class: 'fd-fieldset' },
          el('legend', { class: 'tp-label' }, 'What players see'),
          radios('visibility', M.VISIBILITY, f.visibility, (visibility) => set({ visibility })),
          f.visibility === 'shown'
            ? field('Players read', el('textarea', { class: 'tp-textarea', rows: 2, 'data-key': 'shown', placeholder: 'What the players know about this…', onInput: (e) => set({ shown: e.target.value }, { inspector: false }) }, f.shown), 'Shown instead of the real contents')
            : null,
          f.visibility === 'rumored'
            ? [field('Obscured as', el('select', { class: 'tp-select', onChange: (e) => set({ rumor: { ...f.rumor, style: e.target.value } }) },
                M.OBSCURITY.map((o) => el('option', { value: o.id, selected: f.rumor.style === o.id }, o.label)))),
              f.rumor.style === 'text'
                ? field('Obscuring text', el('input', { class: 'tp-input', value: f.rumor.text, maxlength: 200, placeholder: '???', 'data-key': 'rumor-text', onInput: (e) => set({ rumor: { ...f.rumor, text: e.target.value } }, { inspector: false }) }))
                : null]
            : null),
        el('label', { class: 'fd-check fd-check--block' },
          el('input', { type: 'checkbox', checked: f.references, onChange: (e) => set({ references: e.target.checked }) }),
          el('span', {}, el('strong', {}, 'References'), el('span', { class: 'tp-dim' }, ' · GM only. Link other entities to this field for quick access; players never see them.'))),
        fixed ? el('p', { class: 'tp-dim fd-static' }, 'Default fields can\'t be removed or moved.')
          : el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--danger tp-btn--sm', onClick: () => removeField(f.id) }, 'Remove field')),
    );
    restoreFocus(inspector);
  }

  // --- preview -------------------------------------------------------------------------------

  // --- Create New ----------------------------------------------------------------------------

  const lookup = (id) => {
    const c = s.people.find((x) => x.id === id);
    return c ? { name: c.name, href: hrefOf(c), image: c.image } : null;
  };

  async function refreshPeople() {
    s.people = await allEntities().catch(() => s.people);
  }

  function renderCreator() {
    if (entry) return; // nothing is created from an entry's sheet
    // The button names what it makes: "Create NPC", "Create Rumor", "Create item".
    const what = () => categoryOf(KIND, s.forging.values.category)?.label ?? ENTITY;
    const button = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary fd-create__go', onClick: createNew }, `Create ${what()}`);
    form = valuesForm({ sheet: s.preset, state: s.forging, candidates: s.people, onChange: () => ((button.textContent = `Create ${what()}`), renderPreview()) });
    creator.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, 'Create New'),
        el('span', { class: 'tp-dim' }, `Fill in a ${ENTITY} from this preset; the sheet beside it follows along.`)),
      el('div', { class: 'tp-panel__body' },
        form.node,
        el('div', { class: 'fd-create__foot' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => { s.forging = freshForging(s.preset); renderCreator(); renderPreview(); } }, 'Clear form'),
          button)),
    );
    async function createNew() {
      let character;
      try {
        character = forge(s.preset, s.forging);
      } catch (err) {
        toastError(err);
        creator.querySelector('[data-key="v:name"]')?.focus();
        return;
      }
      button.disabled = true;
      try {
        const made = await entities.create(character);
        // Characters and stories land on their category's tab; items in the one Items list.
        // Net cards all land in the Card Forge's library.
        const where = KIND === 'netcards' ? null : categoryOf(KIND, made.category);
        toast(`Created "${made.name}" in ${where ? plural(where.label) : KIND === 'netcards' ? 'your net cards' : M.kindOf(KIND).label}`, {
          tone: 'success', timeout: 8000, link: { href: hrefOf(made), label: 'Open' },
        });
        onCreated?.(made);
        await refreshPeople();
        s.forging = freshForging(s.preset);
        renderCreator();
        renderPreview();
      } catch (err) {
        toastError(err);
      } finally {
        button.disabled = false;
      }
    }
  }

  function renderPreview() {
    const f = s.forging ?? freshForging(s.preset);
    preview.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, 'Preview'),
        el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Preview as' },
          [['gm', 'GM view'], ['player', 'Player view']].map(([v, label]) =>
            el('button', { type: 'button', class: `fd-seg__btn ${s.view === v ? 'is-on' : ''}`, 'aria-pressed': String(s.view === v), onClick: () => ((s.view = v), renderPreview()) }, label)))),
      el('div', { class: 'tp-panel__body' }, renderSheet(s.preset, { view: s.view, preview: true, values: f.values, shown: f.shown, refs: f.refs, lookup, imageUrl })),
    );
  }

  // Redraws replace inputs: put the caret back where the GM was typing.
  let focusMemo = null;
  document.addEventListener('focusin', trackFocus);
  document.addEventListener('selectionchange', trackFocus);
  function trackFocus() {
    const a = document.activeElement;
    if (a?.dataset?.key && page.contains(a)) focusMemo = { key: a.dataset.key, start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(scope) {
    if (!focusMemo) return;
    const input = scope.querySelector(`[data-key="${CSS.escape(focusMemo.key)}"]`);
    if (!input || document.activeElement === input) return;
    input.focus();
    try {
      input.setSelectionRange(focusMemo.start, focusMemo.end);
    } catch {
      /* number inputs have no caret */
    }
  }

  // --- keys and leaving -----------------------------------------------------------------------

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  };
  const onUnload = (e) => {
    if (dirty()) e.preventDefault(); // the draft is kept anyway; this just asks before closing
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);

  // --- start: restore the draft, else the last preset, else a new one ---------------------------------
  // (An entry's sheet: just that.)

  const handle = {
    relabel: renderAll,
    unmount() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', trackFocus);
      document.removeEventListener('selectionchange', trackFocus);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
  if (entry) {
    await refreshPeople();
    load({ name: entry.presetName || 'Sheet', kind: KIND, fields: entry.sheet.fields, layout: entry.sheet.layout });
    return handle;
  }

  await refreshLibrary();
  let draft = null;
  try {
    draft = JSON.parse(store.get(DRAFT_KEY()) ?? 'null');
  } catch {
    draft = null;
  }
  await refreshPeople();
  let restored = null;
  try {
    restored = draft?.preset?.fields ? M.normalizePreset(draft.preset) : null;
  } catch {
    restored = null; // a draft this version can't read: start from the library instead
  }
  if (restored) {
    s.preset = { ...restored, updatedAt: draft.preset.updatedAt };
    s.saved = draft.saved ?? '';
    s.isNew = Boolean(draft.isNew) || !s.library.some((p) => p.id === draft.preset.id);
    s.forging = freshForging(s.preset);
    s.collapsed = foldedFor(s.preset);
    renderAll();
  } else {
    await openFirst(true);
  }

  return handle;
}
