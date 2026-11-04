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

import { el, store, toast, toastError, confirmDialog, download } from '../ui.js';
import { presetsApi, entitiesApi, allEntities, imageUrl, currentProjectId } from '../api.js';
import * as M from './preset-model.js';
import { renderSheet, rarityBadge } from './sheet.js';
import { valuesForm } from './values-form.js';
import { forge, defaultValues, categoryOf, hrefOf, plural } from './entity-model.js';

// Kept per project: each project has its own draft and last-opened preset.
const DRAFT_KEY = () => `tempest.${currentProjectId()}.forge.${KIND}.draft`;
const LAST_KEY = () => `tempest.${currentProjectId()}.forge.${KIND}.last`;
let KIND = 'characters'; // the kind being designed (set by mount)
const TYPE_ICON = { rarity: '✦', category: '◈', image: '▣', text: 'T', size: '⇕', shorttext: '¶', date: '◷', parent: '↑', longtext: '≡', gallery: '▦', stat: '◧', cast: '⚔', location: '⌖' };

export async function mount(root, { tab } = {}) {
  KIND = ['stories', 'items'].includes(tab?.id) ? tab.id : 'characters';
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
  };
  const freshForging = (preset) => ({ values: defaultValues(preset), shown: {}, refs: {}, touched: new Set() });

  const dirty = () => JSON.stringify(s.preset) !== s.saved;
  const persistDraft = () => store.set(DRAFT_KEY(), JSON.stringify({ preset: s.preset, saved: s.saved, isNew: s.isNew }));

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
    s.forging = freshForging(preset);
    form = null;
    if (!isNew) store.set(LAST_KEY(), preset.id);
    persistDraft();
    renderAll();
  }

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
  const builder = el('div', { class: 'fd-builder' });
  const inspector = el('aside', { class: 'tp-frame tp-panel fd-inspector', 'aria-label': 'Field settings' });
  const preview = el('section', { class: 'tp-frame tp-panel fd-preview', 'aria-label': 'Preview' });
  const creator = el('section', { class: 'tp-frame tp-panel fd-create', 'aria-label': 'Create New' });
  const page = el('div', { class: 'fd' }, toolbar, el('div', { class: 'fd-work' }, builder, inspector), preview, creator);
  root.append(page);
  let form = null; // the Create New values form

  function renderAll() {
    renderToolbar();
    renderBuilder();
    renderInspector();
    renderCreator();
    renderPreview();
  }

  // --- toolbar: library and file actions -----------------------------------------------------

  function renderToolbar() {
    const options = s.library.map((p) => el('option', { value: p.id, selected: p.id === s.preset.id }, p.name));
    if (s.isNew) options.unshift(el('option', { value: s.preset.id, selected: true }, `${s.preset.name} (not saved yet)`));
    toolbar.replaceChildren(
      el('div', { class: 'tp-panel__body fd-toolbar__body' },
        el('label', { class: 'tp-field fd-toolbar__pick' },
          el('span', { class: 'tp-label' }, `Presets (${s.library.length})`),
          el('select', { class: 'tp-select', 'aria-label': 'Open a preset', onChange: (e) => openPreset(e.target.value) }, options)),
        el('label', { class: 'tp-field fd-toolbar__name' },
          el('span', { class: 'tp-label' }, 'Preset name'),
          el('input', {
            class: 'tp-input', value: s.preset.name, maxlength: 80, 'data-key': 'preset-name',
            onInput: (e) => change({ ...s.preset, name: e.target.value }, { inspector: false }),
          })),
        el('span', { class: `fd-status ${dirty() ? 'is-dirty' : ''}`, role: 'status' }, s.isNew ? 'Not saved yet' : dirty() ? 'Unsaved changes' : 'Saved'),
        el('div', { class: 'app-actions fd-toolbar__actions' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: save, disabled: !dirty() && !s.isNew, title: 'Save (Ctrl+S)' }, 'Save'),
          el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: newPreset }, 'New'),
          el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: duplicate }, 'Duplicate'),
          el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: importPreset, title: 'Load a preset from a .json file' }, 'Import'),
          el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: exportPreset, title: 'Save this preset as a .json file to share or back up' }, 'Export'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: remove }, s.isNew ? 'Discard' : 'Delete'))));
    restoreFocus(toolbar); // keep typing in the name box after the redraw
  }

  // --- builder: main section, lower sections, add palette ---------------------------------------

  const sameTarget = (a, b) => a.area === b.area && (a.area === 'main' || (a.section === b.section && a.column === b.column));

  function chip(id) {
    const f = s.preset.fields[id];
    const fixed = M.defaultIdsOf(KIND).includes(id);
    const at = M.locate(s.preset, id);
    const listLength = fixed ? 0 : at.area === 'main' ? s.preset.layout.main.length : s.preset.layout.sections.find((x) => x.id === at.section).columns[at.column].length;
    const vis = f.visibility !== 'revealed' ? el('span', { class: `fd-chip__vis fd-chip__vis--${f.visibility}` }, f.visibility === 'shown' ? 'Shown' : 'Rumored') : null;
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
    return sec.columns.length > 1 ? `${name}, column ${t.column + 1}` : name;
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
    change(out.preset);
    builder.querySelector(`[data-section="${out.id}"] input`)?.select();
  }

  async function removeField(id) {
    const f = s.preset.fields[id];
    change(M.removeField(s.preset, id));
    toast(`Removed "${f.label}"`);
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
          el('span', { class: 'fd-palette__to tp-dim' }, 'to ', el('strong', {}, targetName(s.target)), ' · click a list to choose where'))),
      el('div', { class: 'tp-frame tp-panel fd-area fd-area--main' },
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Main section'), el('span', { class: 'tp-dim' }, 'Always at the top')),
        el('div', { class: 'tp-panel__body' },
          el('ul', { class: 'fd-list fd-list--fixed' }, M.defaultIdsOf(KIND).map(chip)),
          dropList({ area: 'main' }, p.layout.main, 'Fields added here appear under the defaults.'))),
      p.layout.sections.map((sec, i) =>
        el('div', { class: 'tp-frame tp-panel fd-area', 'data-section': sec.id },
          el('header', { class: 'tp-panel__head fd-area__head' },
            el('input', {
              class: 'tp-input fd-area__title', value: sec.title, placeholder: 'Untitled section', maxlength: 60, 'aria-label': 'Section title', 'data-key': `section:${sec.id}`,
              onInput: (e) => change(M.updateSection(s.preset, sec.id, { title: e.target.value })),
            }),
            el('label', { class: 'fd-area__cols' },
              el('span', { class: 'tp-label' }, 'Columns'),
              el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Columns' },
                [1, 2, 3].map((n) => el('button', { type: 'button', class: `fd-seg__btn ${sec.columns.length === n ? 'is-on' : ''}`, 'aria-pressed': String(sec.columns.length === n), onClick: () => change(M.setColumns(s.preset, sec.id, n)) }, n)))),
            el('span', { class: 'fd-area__tools' },
              el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move section up', disabled: i === 0, onClick: () => change(M.moveSection(s.preset, sec.id, -1)) }, '▲'),
              el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move section down', disabled: i === p.layout.sections.length - 1, onClick: () => change(M.moveSection(s.preset, sec.id, 1)) }, '▼'),
              el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': 'Remove section', onClick: () => removeSection(sec) }, '×'))),
          el('div', { class: `tp-panel__body fd-columns fd-columns--${sec.columns.length}` },
            sec.columns.map((col, c) => dropList({ area: 'section', section: sec.id, column: c }, col, sec.columns.length > 1 ? `Column ${c + 1}: drop or add fields` : 'Drop or add fields here'))))),
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
        value: `${sec.id}:${c}`, label: sec.columns.length > 1 ? `${sec.title || 'Untitled section'} › Column ${c + 1}` : sec.title || 'Untitled section',
        target: { area: 'section', section: sec.id, column: c },
      }));
    }
    const current = at.area === 'main' ? 'main' : `${at.section}:${at.column}`;
    return el('select', {
      class: 'tp-select', 'aria-label': 'Location',
      onChange: (e) => change(M.moveField(s.preset, f.id, options.find((o) => o.value === e.target.value).target)),
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
      default:
        return [];
    }
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
        `Always set: it decides which ${KIND === 'stories' ? 'World' : 'Characters'} tab a ${ENTITY} made from this preset goes in`);
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
    form = valuesForm({ sheet: s.preset, state: s.forging, candidates: s.people, onChange: renderPreview });
    const button = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary fd-create__go', onClick: createNew }, 'Create New');
    creator.replaceChildren(
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, 'Create New'),
        el('span', { class: 'tp-dim' }, `Fill in a ${ENTITY} from this preset; the preview above follows along.`)),
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
        const where = categoryOf(KIND, made.category);
        toast(`Created "${made.name}" in ${where ? plural(where.label) : M.kindOf(KIND).label}`, {
          tone: 'success', timeout: 8000, link: { href: hrefOf(made), label: 'Open' },
        });
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
    renderAll();
  } else {
    await openFirst(true);
  }

  return {
    relabel: renderAll,
    unmount() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', trackFocus);
      document.removeEventListener('selectionchange', trackFocus);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
}
