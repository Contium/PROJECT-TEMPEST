// Entity editor: a form generated from the entity type's field definitions.
// Saves as one batch: a create, or an update containing only what changed.

import { el, toast, toastError, TIER_NAMES } from '../ui.js';
import { gameTimeInput, toInputValue, fromInputValue } from '../time.js';
import { refTypesOf } from '../model.js';

const VISIBILITY = [
  ['hidden', 'GM only', 'Players cannot see it at all'],
  ['rumored', 'Rumoured', 'Players see the name and the Rumour field only'],
  ['known', 'Known', 'Players see everything not marked secret'],
];
const WIDE = new Set(['longtext', 'refs', 'tags', 'image', 'gallery']);
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_EDGE = 1600;

/**
 * Shrink large images before upload so universe files stay small. GIFs pass
 * through untouched (re-encoding would drop animation).
 */
async function prepareImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use a PNG, JPEG, GIF or WebP image');
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image'))), 'image/webp', 0.88));
}

function imageInput(id, value, ctx) {
  let current = value ?? null;
  const preview = el('div', { class: 'ed__image-preview' });
  const status = el('span', { class: 'ed__hint', role: 'status' });
  const file = el('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true });
  const remove = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm' }, 'Remove');
  const paint = () => {
    preview.replaceChildren(current ? el('img', { src: ctx.api.imageUrl(current), alt: 'Selected image' }) : el('span', { class: 'ed__hint' }, 'Drop, paste or choose an image'));
    remove.hidden = !current;
  };
  const take = async (blob) => {
    if (!blob) return;
    status.textContent = 'Uploading…';
    try {
      current = (await ctx.api.uploadImage(await prepareImage(blob))).id;
      status.textContent = '';
      paint();
    } catch (err) {
      status.textContent = '';
      toastError(err);
    }
  };
  remove.addEventListener('click', () => ((current = null), paint()));

  const zone = el('div', { class: 'ed__image', id, tabindex: 0, 'aria-label': 'Image: drop or paste a file here, or press Choose' },
    preview,
    el('div', { class: 'app-row' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => file.click() }, 'Choose…'),
      remove,
      status),
    file);
  acceptImages(zone, file, take);
  paint();
  return { node: zone, read: () => current };
}

/** Accept image files dropped/pasted/chosen on `zone`; calls take(file) for each. */
function acceptImages(zone, picker, take) {
  const each = async (files) => {
    for (const f of [...files].filter((x) => x.type.startsWith('image/'))) await take(f);
  };
  picker.addEventListener('change', () => each(picker.files).then(() => (picker.value = '')));
  zone.addEventListener('dragover', (e) => (e.preventDefault(), zone.classList.add('is-dragging')));
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragging');
    each(e.dataTransfer.files);
  });
  zone.addEventListener('paste', (e) => {
    if ([...e.clipboardData.files].some((f) => f.type.startsWith('image/'))) (e.preventDefault(), each(e.clipboardData.files));
  });
}

/** Labelled image list (maps): each item { image, label?, revealed? }. */
function galleryInput(id, value, ctx) {
  const items = (value ?? []).map((item) => ({ ...item }));
  const list = el('div', { class: 'ed__gallery' });
  const status = el('span', { class: 'ed__hint', role: 'status' });
  const picker = el('input', { type: 'file', accept: IMAGE_TYPES.join(','), multiple: true, hidden: true });

  const move = (i, by) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    paint();
  };
  const paint = () =>
    list.replaceChildren(
      ...items.map((item, i) =>
        el('div', { class: 'ed__gallery-item' },
          el('img', { src: ctx.api.imageUrl(item.image), alt: item.label || `Map ${i + 1}` }),
          el('input', { class: 'tp-input', value: item.label ?? '', placeholder: `Map ${i + 1}`, 'aria-label': `Label for map ${i + 1}`, onInput: (e) => (item.label = e.target.value) }),
          el('label', { class: 'tp-check', title: 'Include this map in what players see' },
            el('input', { type: 'checkbox', checked: Boolean(item.revealed), onChange: (e) => (item.revealed = e.target.checked) }),
            el('span', {}, 'Revealed')),
          el('div', { class: 'app-row' },
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', 'aria-label': 'Move up', disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', 'aria-label': 'Move down', disabled: i === items.length - 1, onClick: () => move(i, 1) }, '↓'),
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', onClick: () => (items.splice(i, 1), paint()) }, 'Remove')))),
      ...(items.length ? [] : [el('span', { class: 'ed__hint' }, 'No maps yet. Drop, paste or choose images.')]),
    );

  const zone = el('div', { class: 'ed__image ed__gallery-zone', id, tabindex: 0, 'aria-label': 'Maps: drop or paste images here, or press Add maps' },
    list,
    el('div', { class: 'app-row' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => picker.click() }, '+ Add maps'),
      status),
    picker);
  acceptImages(zone, picker, async (file) => {
    status.textContent = `Uploading ${file.name || 'image'}…`;
    try {
      const { id: image } = await ctx.api.uploadImage(await prepareImage(file));
      // Name the map after its file ("ground-floor.png" → "ground floor")
      const label = (file.name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      items.push({ image, ...(label && label !== 'image' ? { label } : {}), revealed: false });
      paint();
    } catch (err) {
      toastError(err);
    } finally {
      status.textContent = '';
    }
  });
  paint();
  return {
    node: zone,
    read: () =>
      items.length
        ? items.map(({ image, label, revealed }) => ({ image, ...(label?.trim() ? { label: label.trim() } : {}), ...(revealed ? { revealed: true } : {}) }))
        : null,
  };
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function refOptions(names, field, selfId, ctx) {
  const allowed = refTypesOf(field);
  return [...names.values()]
    .filter((e) => !e.deleted && e.type !== 'relation' && e.id !== selfId && (!allowed || allowed.includes(e.type)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => el('option', { value: e.id }, allowed?.length === 1 ? e.name : `${e.name} (${ctx.typeLabel(e.type)})`));
}

/** Returns { node, read } for one field. read() → value or null; may throw on bad input. */
function fieldInput(field, value, { ctx, names, selfId }) {
  const id = `f-${field.key}`;
  switch (field.type) {
    case 'image':
      return imageInput(id, value, ctx);
    case 'gallery':
      return galleryInput(id, value, ctx);
    case 'longtext': {
      const node = el('textarea', { class: 'tp-textarea', id, value: value ?? '' });
      return { node, read: () => node.value.trim() || null };
    }
    case 'number': {
      const node = el('input', { class: 'tp-input', id, type: 'number', step: 'any', value: value ?? '' });
      return { node, read: () => (node.value === '' ? null : Number(node.value)) };
    }
    case 'bool': {
      const node = el('select', { class: 'tp-select', id, value: value == null ? '' : String(value) },
        el('option', { value: '' }, '—'), el('option', { value: 'true' }, 'Yes'), el('option', { value: 'false' }, 'No'));
      return { node, read: () => (node.value === '' ? null : node.value === 'true') };
    }
    case 'enum': {
      const node = el('select', { class: 'tp-select', id, value: value ?? '' },
        el('option', { value: '' }, '—'), field.options.map((o) => el('option', { value: o }, o[0].toUpperCase() + o.slice(1))));
      return { node, read: () => node.value || null };
    }
    case 'tier': {
      const node = el('select', { class: 'tp-select', id, value: value == null ? '' : String(value) },
        el('option', { value: '' }, '—'), TIER_NAMES.map((n, i) => el('option', { value: String(i + 1) }, `${i + 1} · ${n}`)));
      return { node, read: () => (node.value === '' ? null : Number(node.value)) };
    }
    case 'meter': {
      let touched = false;
      const range = el('input', { type: 'range', id, min: 0, max: 100, value: Math.round((value ?? 0) * 100) });
      const out = el('output', { class: 'tp-mono' }, value == null ? '—' : `${Math.round(value * 100)}%`);
      range.addEventListener('input', () => ((touched = true), (out.textContent = `${range.value}%`)));
      return { node: el('div', { class: 'ed__meter' }, range, out), read: () => (touched ? Number(range.value) / 100 : value ?? null) };
    }
    case 'ref': {
      const node = el('select', { class: 'tp-select', id, value: value ?? '' }, el('option', { value: '' }, '—'), refOptions(names, field, selfId, ctx));
      return { node, read: () => node.value || null };
    }
    case 'refs': {
      const node = el('select', { class: 'tp-select', id, multiple: true }, refOptions(names, field, selfId, ctx));
      for (const opt of node.options) opt.selected = (value ?? []).includes(opt.value);
      return {
        node: el('div', {}, node, el('span', { class: 'ed__hint' }, 'Ctrl+click to pick several')),
        read: () => {
          const picked = [...node.selectedOptions].map((o) => o.value);
          return picked.length ? picked : null;
        },
      };
    }
    case 'tags': {
      const node = el('input', { class: 'tp-input', id, value: (value ?? []).join(', '), placeholder: 'comma, separated' });
      return {
        node,
        read: () => {
          const tags = node.value.split(',').map((t) => t.trim()).filter(Boolean);
          return tags.length ? tags : null;
        },
      };
    }
    case 'gametime': {
      const cal = ctx.meta.calendar;
      const node = el('input', { class: 'tp-input', id, ...gameTimeInput(cal), value: toInputValue(value, cal) });
      return { node, read: () => fromInputValue(node.value, cal) };
    }
    default: {
      const node = el('input', { class: 'tp-input', id, value: value ?? '' });
      return { node, read: () => node.value.trim() || null };
    }
  }
}

/**
 * Build the editor. `entity` is null when creating.
 * onDone(id | null) runs after a successful save (id) or cancel (null).
 */
export async function buildEditor({ ctx, type, entity, onDone }) {
  const names = await ctx.names();
  const data = entity?.data ?? {};
  const secret = new Set(entity?.secretFields ?? []);
  let visibility = entity?.visibility ?? 'hidden';

  // --- Name + visibility
  const nameInput = el('input', {
    class: 'tp-input', id: 'f-name', value: entity?.name ?? '',
    placeholder: type.id === 'relation' ? 'Optional: named automatically from From, Kind and To' : `Name this ${ctx.typeLabel(type).toLowerCase()}`,
  });
  const visButtons = VISIBILITY.map(([value, label, hint]) =>
    el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', title: hint, dataset: { value } }, label),
  );
  const paintVisibility = () =>
    visButtons.forEach((b) => {
      const on = b.dataset.value === visibility;
      b.classList.toggle('tp-btn--interactive', on);
      b.setAttribute('aria-pressed', String(on));
    });
  visButtons.forEach((b) => b.addEventListener('click', () => ((visibility = b.dataset.value), paintVisibility())));
  paintVisibility();

  // --- Declared fields
  const inputs = type.fields.map((field) => {
    const input = fieldInput(field, data[field.key], { ctx, names, selfId: entity?.id });
    let lock = null;
    if (field.secret) {
      lock = el('span', { class: 'tp-badge tp-badge--danger', title: 'This field is never shown to players' }, 'Always secret');
    } else {
      lock = el('button', { type: 'button', class: 'ed__lock', title: 'Hide this field from players' });
      const paint = () => {
        const on = secret.has(field.key);
        lock.setAttribute('aria-pressed', String(on));
        lock.textContent = on ? 'GM only' : 'Shared';
      };
      lock.addEventListener('click', () => (secret.has(field.key) ? secret.delete(field.key) : secret.add(field.key), paint()));
      paint();
    }
    const node = el(
      'div',
      { class: `tp-field ${WIDE.has(field.type) ? 'ed__field--wide' : ''}` },
      el('div', { class: 'ed__label' }, el('label', { class: 'tp-label', for: `f-${field.key}` }, ctx.fieldLabel(field), field.required ? ' *' : ''), lock),
      input.node,
      field.hint ? el('span', { class: 'ed__hint' }, field.hint) : null,
    );
    return { field, node, read: input.read };
  });

  // --- Undeclared (custom) fields on this entity
  const declared = new Set(type.fields.map((f) => f.key));
  const custom = [];
  const customHost = el('div', { class: 'ed__grid' });
  const addCustomRow = (key = '', value = '') => {
    const keyInput = el('input', { class: 'tp-input', value: key, placeholder: 'field_name', 'aria-label': 'Custom field name' });
    const valueInput = el('input', { class: 'tp-input', value: Array.isArray(value) ? value.join(', ') : value, placeholder: 'value', 'aria-label': 'Custom field value' });
    const row = { originalKey: key || null, originalValue: value, keyInput, valueInput, removed: false };
    const node = el('div', { class: 'tp-field' },
      el('div', { class: 'ed__label' }, el('span', { class: 'tp-label' }, 'Custom field'),
        el('button', { type: 'button', class: 'ed__lock', onClick: () => ((row.removed = true), node.remove()) }, 'Remove')),
      el('div', { class: 'app-row' }, keyInput, valueInput),
    );
    custom.push(row);
    customHost.append(node);
  };
  Object.entries(data).filter(([k]) => !declared.has(k)).forEach(([k, v]) => addCustomRow(k, v));

  // --- Commit details: note, event, when
  const cal = ctx.meta.calendar;
  const noteInput = el('input', { class: 'tp-input', id: 'f-note', placeholder: entity ? 'What changed, in-world? (optional)' : 'How did this enter the story? (optional)' });
  const asEvent = el('input', { type: 'checkbox' });
  const eventPublic = el('input', { type: 'checkbox', checked: true });
  const whenInput = el('input', { class: 'tp-input', id: 'f-when', ...gameTimeInput(cal), value: toInputValue(ctx.meta.clock, cal) });

  const form = el(
    'form',
    { class: 'ed', novalidate: true },
    el('div', { class: 'ed__grid' },
      el('div', { class: 'tp-field ed__field--wide' }, el('label', { class: 'tp-label', for: 'f-name' }, 'Name'), nameInput),
      el('div', { class: 'tp-field ed__field--wide' }, el('span', { class: 'tp-label' }, 'Who knows about it'), el('div', { class: 'ed__seg', role: 'group' }, visButtons)),
      inputs.map((i) => i.node),
    ),
    customHost,
    el('div', {}, el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', onClick: () => addCustomRow() }, '+ Custom field')),
    el(
      'div',
      { class: 'ed__commit' },
      el('div', { class: 'tp-field' }, el('label', { class: 'tp-label', for: 'f-note' }, 'Change note'), noteInput,
        el('div', { class: 'app-row' },
          el('label', { class: 'tp-check' }, asEvent, el('span', {}, `Log as ${ctx.typeLabel('event').toLowerCase()}`)),
          el('label', { class: 'tp-check' }, eventPublic, el('span', {}, 'Players can see it')),
        )),
      el('div', { class: 'tp-field' }, el('label', { class: 'tp-label', for: 'f-when' }, 'When (in-game)'), whenInput,
        el('span', { class: 'ed__hint' }, 'Earlier = backdate. Later = schedule it.')),
    ),
    el(
      'div',
      { class: 'app-actions' },
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => onDone(null) }, 'Cancel'),
      el('button', { type: 'submit', class: 'tp-frame tp-btn tp-btn--primary' }, entity ? 'Save changes' : `Create ${ctx.typeLabel(type)}`),
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let body;
    try {
      body = collect();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
      return;
    }
    if (!body) return toast('Nothing changed', { tone: 'info' });
    try {
      const res = await ctx.api.batch(body);
      // An event-only save touches just the event; stay on the entity being edited.
      const saved = res.entities.find((x) => x.type === type.id && x.id !== res.eventId) ?? entity ?? res.entities[0];
      toast(res.scheduled ? `Scheduled for ${whenInput.value}` : entity ? 'Saved' : `${saved.name} created`, {
        tone: 'success',
        action: { label: 'Undo', run: () => ctx.api.undo(res.batch).catch(toastError) },
      });
      onDone(saved.id);
    } catch (err) {
      toastError(err);
    }
  });

  function collect() {
    const next = {};
    for (const { field, read } of inputs) {
      try {
        next[field.key] = read();
      } catch (err) {
        throw new Error(`${ctx.fieldLabel(field)}: ${err.message}`);
      }
    }
    // Relationships can name themselves: "Okada owes a favour to Patch".
    let name = nameInput.value.trim();
    if (!name && type.id === 'relation' && next.from && next.to && next.kind) {
      name = `${names.get(next.from)?.name} ${next.kind} ${names.get(next.to)?.name}`;
    }
    if (!name) throw new Error(type.id === 'relation' ? 'Pick From, To and Kind (or give it a name)' : 'Give it a name');
    for (const row of custom) {
      if (row.removed) {
        if (row.originalKey) next[row.originalKey] = null;
        continue;
      }
      const key = row.keyInput.value.trim();
      if (!key) continue;
      if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error(`Custom field "${key}": use lowercase letters, digits and _`);
      if (row.originalKey && row.originalKey !== key) next[row.originalKey] = null;
      const raw = row.valueInput.value.trim();
      next[key] = raw === '' ? null : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    }

    const when = fromInputValue(whenInput.value, cal);
    const note = noteInput.value.trim() || null;
    const commit = { note, gameTime: when != null && when !== ctx.meta.clock ? when : undefined };
    if (asEvent.checked) {
      if (!note) throw new Error('Write a change note to name the event');
      commit.event = {
        name: note,
        visibility: eventPublic.checked ? 'known' : 'hidden',
        data: entity ? { participants: [entity.id] } : {},
      };
    }

    if (!entity) {
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v != null));
      return { ...commit, ops: [{ op: 'create', type: type.id, name, visibility, secretFields: [...secret], data: clean }] };
    }

    const patch = {};
    if (name !== entity.name) patch.name = name;
    if (visibility !== entity.visibility) patch.visibility = visibility;
    const secretList = [...secret].sort();
    if (!same(secretList, [...entity.secretFields].sort())) patch.secretFields = secretList;
    for (const [key, value] of Object.entries(next)) {
      if (!same(value, data[key])) patch[`data.${key}`] = value;
    }
    if (!Object.keys(patch).length && !commit.event) return null;
    return { ...commit, ops: Object.keys(patch).length ? [{ op: 'update', id: entity.id, patch }] : [] };
  }

  queueMicrotask(() => nameInput.focus());
  return form;
}
