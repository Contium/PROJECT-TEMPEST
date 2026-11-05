// The values form: one input per field of a sheet, for filling in an entity
// (a character or a story). The designer's Create New uses it, and entity pages
// reuse it to edit. candidates are the project's entities of every kind
// ({ id, kind, name, category }), for links: parents, references, characters
// in a story, locations.
//
// `state` ({ values, shown, refs }) is owned by the caller and changed in place;
// onChange(state) fires after every edit so a preview can follow along.
// Typing never redraws the form (so focus stays put); uploads, gallery edits
// and reference picks redraw just the field they belong to.

import { el, toastError } from '../ui.js';
import { uploadImage, imageUrl } from '../api.js';
import { openImage } from '../image-viewer.js';
import { push } from '../push/push.js';

/** Open uploaded pictures full size, with Push to players (the GM's forms). */
const view = (items, index) => openImage(items.map((x) => ({ ...x, src: imageUrl(x.image) })), index, { push: (x) => push({ mode: 'handout', image: x.image, caption: x.caption }) });
import { SIZES, PARENT_TYPES, fieldsInOrder, defaultIdsOf, categoriesOf } from './preset-model.js';
import { rarityBadge } from './sheet.js';

// What a Parent field can point at, by its parent type (null: nothing of that kind exists yet).
const PARENT_FILTERS = {
  any: () => true,
  character: (c) => c.kind === 'characters' && ['player', 'npc'].includes(c.category),
  monster: (c) => c.kind === 'characters' && c.category === 'monster',
  creature: (c) => c.kind === 'characters' && c.category === 'creature',
  story: (c) => c.kind === 'stories',
  item: (c) => c.kind === 'items',
};
const isCharacter = (c) => c.kind === 'characters';
// Pickers mark entries that aren't characters: "(story)", "(item)".
const kindTag = (c) => ({ stories: ' (story)', items: ' (item)', netcards: ' (net card)' })[c.kind] ?? '';

export function valuesForm({ sheet, state, candidates = [], selfId = null, onChange = () => {} }) {
  const node = el('div', { class: 'vf' });
  const changed = () => onChange(state);
  const setValue = (id, v) => {
    if (v === undefined) delete state.values[id];
    else state.values[id] = v;
    state.touched?.add(id);
    changed();
  };
  const others = candidates.filter((c) => c.id !== selfId);

  // --- editors by type -------------------------------------------------------------------

  function editor(f) {
    const v = state.values[f.id];
    const key = `v:${f.id}`;
    switch (f.type) {
      case 'category':
        return el('span', { class: 'fd-seg vf-seg', role: 'radiogroup', 'aria-label': f.label },
          categoriesOf(sheet).map((c) => el('button', {
            type: 'button', role: 'radio', class: `fd-seg__btn ${v === c.id ? 'is-on' : ''}`, 'aria-checked': String(v === c.id),
            onClick: (e) => {
              setValue(f.id, c.id);
              e.currentTarget.parentElement.querySelectorAll('.fd-seg__btn').forEach((b) => {
                const on = b === e.currentTarget;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-checked', String(on));
              });
            },
          }, c.label)));
      case 'text':
      case 'shorttext':
        return el('input', {
          class: 'tp-input', value: v ?? '', maxlength: f.id === 'name' ? 80 : 400, 'data-key': key, required: f.id === 'name' || null,
          placeholder: f.id === 'name' ? 'Required' : '', onInput: (e) => setValue(f.id, e.target.value),
        });
      case 'longtext':
        return el('textarea', { class: 'tp-textarea', rows: 4, 'data-key': key, onInput: (e) => setValue(f.id, e.target.value) }, v ?? '');
      case 'size':
        return el('select', { class: 'tp-select', onChange: (e) => setValue(f.id, e.target.value) }, SIZES.map((x) => el('option', { value: x, selected: (v ?? 'Medium') === x }, x)));
      case 'image':
        return imageEditor(f);
      case 'gallery':
        return galleryEditor(f);
      case 'parent':
        return parentEditor(f);
      case 'stat':
      case 'rarity':
        return statEditor(f);
      case 'statblock':
        return blockEditor(f);
      case 'date':
        return dateEditor(f);
      case 'cast':
        return f.mode === 'combat' ? sidesEditor(f) : involvedEditor(f);
      case 'location':
        return locationEditor(f);
      default:
        return null;
    }
  }

  /** A picker of entries; onPick(id) gets the chosen id. */
  function picker(list, prompt, onPick, emptyText) {
    if (!list.length) return el('span', { class: 'tp-dim vf-hint' }, emptyText);
    return el('select', {
      class: 'tp-select vf-refs__add', 'aria-label': prompt,
      onChange: (e) => e.target.value && onPick(e.target.value),
    }, el('option', { value: '' }, prompt), list.map((c) => el('option', { value: c.id }, `${c.name}${kindTag(c)}`)));
  }
  const nameOf = (id) => candidates.find((c) => c.id === id)?.name ?? 'Removed entry';
  const chip = (id, onRemove) =>
    el('span', { class: 'tp-badge vf-ref' }, nameOf(id), el('button', { type: 'button', class: 'vf-ref__x', 'aria-label': `Remove ${nameOf(id)}`, onClick: onRemove }, '×'));

  /** In-world date: year (may be negative), month, day, optional time. */
  function dateEditor(f) {
    const wrap = el('span', { class: 'vf-date' });
    const draw = () => {
      const v = state.values[f.id] ?? {};
      const read = () => {
        const n = (name) => {
          const raw = wrap.querySelector(`[name="${name}"]`).value.trim();
          return raw === '' ? undefined : Math.trunc(Number(raw));
        };
        const y = n('y');
        if (y === undefined || !Number.isFinite(y)) return setValue(f.id, undefined);
        const time = wrap.querySelector('[name="time"]').value;
        setValue(f.id, { y, m: n('m'), d: n('d'), ...(time ? { time } : {}) });
      };
      const box = (name, label, value, width) => el('label', { class: 'vf-date__part' }, el('span', { class: 'tp-dim' }, label),
        el('input', { class: `tp-input fd-num vf-date__${name}`, name, type: 'number', value: value ?? '', style: `width:${width}rem`, 'data-key': `v:${f.id}:${name}`, onInput: read }));
      wrap.replaceChildren(
        box('y', 'Year', v.y, 6), box('m', 'Month', v.m, 4.2), box('d', 'Day', v.d, 4.2),
        el('label', { class: 'vf-date__part' }, el('span', { class: 'tp-dim' }, 'Time'),
          el('input', { class: 'tp-input', name: 'time', type: 'time', value: v.time ?? '', 'data-key': `v:${f.id}:time`, onInput: read })),
        el('span', { class: 'tp-dim vf-hint' }, f.id === 'end' ? 'Leave the year empty if it\'s still going' : 'Any calendar; years can be negative'));
    };
    draw();
    return wrap;
  }

  /** Combat: each side's name, faction and fighters. */
  function sidesEditor(f) {
    const wrap = el('div', { class: `vf-sides vf-sides--${f.sides.length}` });
    const current = () => {
      const v = state.values[f.id]?.sides ?? [];
      return f.sides.map((name, i) => ({ name: v[i]?.name ?? name, faction: v[i]?.faction ?? '', members: [...(v[i]?.members ?? [])] }));
    };
    const save = (sides) => setValue(f.id, { sides });
    const draw = () => {
      const sides = current();
      wrap.replaceChildren(...sides.map((s, i) =>
        el('div', { class: 'vf-side' },
          el('input', { class: 'tp-input vf-side__name', value: s.name, maxlength: 60, 'aria-label': `Side ${i + 1} name`, 'data-key': `v:${f.id}:side${i}`,
            onInput: (e) => { const next = current(); next[i].name = e.target.value; save(next); } }),
          el('input', { class: 'tp-input', value: s.faction, maxlength: 80, placeholder: 'Faction (linkable later)', 'aria-label': `Side ${i + 1} faction`, 'data-key': `v:${f.id}:faction${i}`,
            onInput: (e) => { const next = current(); next[i].faction = e.target.value; save(next); } }),
          el('span', { class: 'vf-refs__list' }, s.members.map((id) => chip(id, () => { const next = current(); next[i].members = next[i].members.filter((x) => x !== id); save(next); draw(); }))),
          picker(others.filter((c) => isCharacter(c) && !s.members.includes(c.id)), '+ Add a fighter…',
            (id) => { const next = current(); next[i].members.push(id); save(next); draw(); }, 'Create characters to add them here.'))));
    };
    draw();
    return wrap;
  }

  /** Involved: characters, each with an optional note on their part. */
  function involvedEditor(f) {
    const wrap = el('div', { class: 'vf-involved' });
    const people = () => (state.values[f.id]?.people ?? []).map((p) => ({ ...p }));
    const save = (list) => setValue(f.id, list.length ? { people: list } : undefined);
    const draw = () => {
      const list = people();
      wrap.replaceChildren(
        ...list.map((p, i) =>
          el('div', { class: 'vf-involved__row' },
            el('span', { class: 'tp-badge vf-ref' }, nameOf(p.id)),
            el('input', { class: 'tp-input', value: p.note ?? '', maxlength: 400, placeholder: 'Their part (optional)', 'aria-label': `What ${nameOf(p.id)} did`, 'data-key': `v:${f.id}:note${p.id}`,
              onInput: (e) => { const next = people(); next[i].note = e.target.value; save(next); } }),
            el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove ${nameOf(p.id)}`, onClick: () => { save(people().filter((_, j) => j !== i)); draw(); } }, '×'))),
        picker(others.filter((c) => isCharacter(c) && !list.some((p) => p.id === c.id)), '+ Add a character…',
          (id) => { save([...people(), { id }]); draw(); }, 'Create characters to add them here.'));
    };
    draw();
    return wrap;
  }

  function locationEditor(f) {
    const v = state.values[f.id];
    if (f.mode === 'obscure') {
      return el('input', { class: 'tp-input', value: v?.text ?? '', maxlength: 400, placeholder: 'A short description, e.g. "a cellar that smells of brine"', 'data-key': `v:${f.id}`,
        onInput: (e) => setValue(f.id, e.target.value.trim() ? { text: e.target.value } : undefined) });
    }
    const list = f.mode === 'direct' ? others.filter((c) => c.kind === 'locations') : others;
    if (!list.length) {
      return el('p', { class: 'tp-dim vf-hint' }, f.mode === 'direct' ? 'Location entries can be linked once Locations exist.' : 'Create characters or stories to link one here.');
    }
    return el('select', { class: 'tp-select', onChange: (e) => setValue(f.id, e.target.value ? { id: e.target.value } : undefined) },
      el('option', { value: '' }, 'None'),
      list.map((c) => el('option', { value: c.id, selected: c.id === v?.id }, `${c.name}${kindTag(c)}`)));
  }

  async function pickFiles({ multiple = false } = {}) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple, hidden: true });
      input.addEventListener('change', () => {
        resolve([...input.files]);
        input.remove();
      });
      input.addEventListener('cancel', () => (resolve([]), input.remove()));
      document.body.append(input);
      input.click();
    });
  }

  function imageEditor(f) {
    const wrap = el('div', { class: `vf-image ${f.primary ? 'vf-image--primary' : ''}` });
    const draw = (busy = false) => {
      const id = state.values[f.id];
      wrap.replaceChildren(
        id ? el('img', { class: 'vf-image__thumb sheet__zoomable', src: imageUrl(id), alt: '', title: 'Open full size', onClick: () => view([{ image: id, caption: state.values.name ? `${state.values.name} · ${f.label}` : f.label }], 0) }) : el('div', { class: 'vf-image__thumb sheet__placeholder' }, el('span', {}, '◇')),
        el('span', { class: 'vf-image__tools' },
          el('button', {
            type: 'button', class: 'tp-frame tp-btn tp-btn--sm', disabled: busy,
            onClick: async () => {
              const [file] = await pickFiles();
              if (!file) return;
              draw(true);
              try {
                setValue(f.id, (await uploadImage(file)).id);
              } catch (err) {
                toastError(err);
              }
              draw();
            },
          }, busy ? 'Uploading…' : id ? 'Replace' : 'Choose image'),
          id ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => (setValue(f.id, undefined), draw()) }, 'Remove') : null,
          f.primary ? el('span', { class: 'tp-dim vf-hint' }, 'Shown square (1:1)') : null));
    };
    draw();
    return wrap;
  }

  function galleryEditor(f) {
    const wrap = el('div', { class: 'vf-gallery' });
    const list = () => state.values[f.id] ?? [];
    const draw = (busy = false) => {
      const items = list();
      wrap.replaceChildren(
        items.length
          ? el('ol', { class: 'vf-gallery__list' },
              items.map((item, i) =>
                el('li', { class: 'vf-gallery__item' },
                  el('img', { class: 'sheet__zoomable', src: imageUrl(item.image), alt: '', title: 'Open full size', onClick: () => view(items.map((x, j) => ({ image: x.image, caption: x.label || `${f.label} ${j + 1}` })), i) }),
                  el('input', {
                    class: 'tp-input', value: item.label ?? '', placeholder: f.mode === 'floors' ? `Floor ${i + 1}` : `Image ${i + 1}`, maxlength: 60, 'data-key': `v:${f.id}:${i}`,
                    'aria-label': `Label for image ${i + 1}`,
                    onInput: (e) => {
                      items[i] = { image: item.image, ...(e.target.value.trim() ? { label: e.target.value } : {}) };
                      setValue(f.id, items);
                    },
                  }),
                  el('span', { class: 'vf-gallery__tools' },
                    el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move earlier', disabled: i === 0, onClick: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); setValue(f.id, items); draw(); } }, '◀'),
                    el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move later', disabled: i === items.length - 1, onClick: () => { items.splice(i + 1, 0, items.splice(i, 1)[0]); setValue(f.id, items); draw(); } }, '▶'),
                    el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': 'Remove image', onClick: () => { items.splice(i, 1); setValue(f.id, items.length ? items : undefined); draw(); } }, '×')))))
          : el('p', { class: 'tp-dim vf-hint' }, 'No images yet.'),
        el('button', {
          type: 'button', class: 'tp-frame tp-btn tp-btn--sm', disabled: busy || items.length >= 30,
          onClick: async () => {
            const files = await pickFiles({ multiple: true });
            if (!files.length) return;
            draw(true);
            const next = [...list()];
            for (const file of files.slice(0, 30 - next.length)) {
              try {
                next.push({ image: (await uploadImage(file)).id, label: file.name.replace(/\.[^.]+$/, '').slice(0, 60) });
              } catch (err) {
                toastError(err);
              }
            }
            setValue(f.id, next.length ? next : undefined);
            draw();
          },
        }, busy ? 'Uploading…' : '+ Add images'));
    };
    draw();
    return wrap;
  }

  function parentEditor(f) {
    const allowed = PARENT_FILTERS[f.parentType];
    const typeLabel = PARENT_TYPES.find((t) => t.id === f.parentType)?.label ?? 'entry';
    if (!allowed) return el('p', { class: 'tp-dim vf-hint' }, `${typeLabel} entries can be linked once that section is built.`);
    const options = others.filter(allowed);
    const v = state.values[f.id]?.id ?? '';
    const none = f.parentType === 'any' ? 'entries' : typeLabel.toLowerCase();
    return el('select', { class: 'tp-select', onChange: (e) => setValue(f.id, e.target.value ? { id: e.target.value } : undefined) },
      el('option', { value: '' }, options.length ? 'None' : `No ${none} yet`),
      options.map((c) => el('option', { value: c.id, selected: c.id === v }, `${c.name}${kindTag(c)}`)));
  }

  function statEditor(f) {
    const v = state.values[f.id] ?? f.default ?? {};
    if (f.stat === 'rarity') {
      const sample = el('span', {});
      const pick = (id) => sample.replaceChildren(rarityBadge(f.rarities.find((r) => r.id === id) ?? f.rarities[0]));
      pick(v.rarity);
      return el('span', { class: 'fd-inline' },
        el('select', { class: 'tp-select', onChange: (e) => (setValue(f.id, { rarity: e.target.value }), pick(e.target.value)) },
          f.rarities.map((r) => el('option', { value: r.id, selected: r.id === v.rarity }, r.name))),
        sample);
    }
    const num = (key, label) => el('label', { class: 'fd-inline' }, label,
      el('input', {
        class: 'tp-input fd-num', type: 'number', value: v[key] ?? 0, 'data-key': `v:${f.id}:${key}`,
        onInput: (e) => {
          const cur = state.values[f.id] ?? { ...f.default };
          setValue(f.id, { ...cur, [key]: Number(e.target.value) || 0 });
        },
      }));
    return el('span', { class: 'fd-inline' }, num('value', f.stat === 'fixed' ? 'Value' : 'Current'), f.stat !== 'fixed' ? num('max', 'Limit') : null,
      f.stat === 'flex' ? el('span', { class: 'tp-dim vf-hint' }, 'may go past the limit') : null);
  }

  /** A Stat Block: one small box per stat, named above it. */
  function blockEditor(f) {
    const v = state.values[f.id] ?? f.default ?? {};
    return el('span', { class: 'vf-block' },
      f.stats.map((st) => el('label', { class: 'vf-block__stat' },
        el('span', { class: 'tp-label' }, st.label),
        el('input', {
          class: 'tp-input vf-block__input', value: v[st.id] ?? '', maxlength: 12, 'data-key': `v:${f.id}:${st.id}`, 'aria-label': `${f.label}: ${st.label}`,
          onInput: (e) => {
            const cur = { ...(state.values[f.id] ?? f.default ?? {}) };
            if (e.target.value.trim()) cur[st.id] = e.target.value;
            else delete cur[st.id];
            setValue(f.id, cur);
          },
        }))));
  }

  // --- per-field extras: player text, references ---------------------------------------------

  function shownEditor(f) {
    return el('label', { class: 'vf-extra' },
      el('span', { class: 'tp-label' }, 'Players read'),
      el('textarea', {
        class: 'tp-textarea', rows: 2, 'data-key': `shown:${f.id}`, placeholder: 'What the players know about this…',
        onInput: (e) => {
          state.shown[f.id] = e.target.value;
          changed();
        },
      }, state.shown[f.id] ?? f.shown ?? ''));
  }

  function refsEditor(f) {
    const wrap = el('div', { class: 'vf-extra vf-refs' });
    const draw = () => {
      const ids = state.refs[f.id] ?? [];
      const byId = new Map(others.map((c) => [c.id, c]));
      const free = others.filter((c) => !ids.includes(c.id));
      wrap.replaceChildren(
        el('span', { class: 'tp-label' }, 'References (GM only)'),
        el('span', { class: 'vf-refs__list' },
          ids.length ? ids.map((id) =>
            el('span', { class: 'tp-badge vf-ref' }, byId.get(id)?.name ?? 'Removed entry',
              el('button', { type: 'button', class: 'vf-ref__x', 'aria-label': `Remove reference to ${byId.get(id)?.name ?? 'entry'}`, onClick: () => { state.refs[f.id] = ids.filter((x) => x !== id); changed(); draw(); } }, '×')))
            : el('span', { class: 'tp-dim vf-hint' }, 'None yet.')),
        free.length
          ? el('select', {
              class: 'tp-select vf-refs__add', 'aria-label': 'Add a reference',
              onChange: (e) => {
                if (!e.target.value) return;
                state.refs[f.id] = [...ids, e.target.value];
                changed();
                draw();
              },
            }, el('option', { value: '' }, '+ Link an entry…'), free.map((c) => el('option', { value: c.id }, `${c.name}${kindTag(c)}`)))
          : el('span', { class: 'tp-dim vf-hint' }, others.length ? '' : 'Create more entries to link them here.'));
    };
    draw();
    return wrap;
  }

  // --- layout ----------------------------------------------------------------------------

  function row(f) {
    if (!f) return null;
    const vis = f.visibility !== 'revealed' ? el('span', { class: `fd-chip__vis fd-chip__vis--${f.visibility}` }, f.visibility === 'shown' ? 'Shown' : 'Rumored') : null;
    const ed = editor(f);
    return el('div', { class: `vf-row vf-row--${f.type}` },
      el('div', { class: 'vf-row__label' }, el('span', { class: 'tp-label' }, f.label, f.id === 'name' ? ' *' : ''), vis),
      el('div', { class: 'vf-row__input' },
        ed,
        f.visibility === 'shown' ? shownEditor(f) : null,
        f.references ? refsEditor(f) : null));
  }

  // Sections fold away (<details>), so a long sheet's form stays short; long sheets
  // (more than FOLD_OVER sections) start folded. What's open survives redraws.
  const FOLD_OVER = 5;
  let open = null; // ids of the open sections; null until the first draw

  function draw() {
    const fields = sheet.fields;
    if (!open) open = new Set(sheet.layout.sections.length > FOLD_OVER ? [] : sheet.layout.sections.map((s) => s.id));
    const many = sheet.layout.sections.length > 1;
    const setAll = (on) => {
      open = new Set(on ? sheet.layout.sections.map((s) => s.id) : []);
      draw();
    };
    node.replaceChildren(...[
      el('div', { class: 'vf-group' }, [...defaultIdsOf(sheet), ...sheet.layout.main].map((id) => row(fields[id]))),
      many
        ? el('div', { class: 'vf-folds' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => setAll(true) }, 'Open all sections'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => setAll(false) }, 'Close all'))
        : null,
      sheet.layout.sections.map((s) => {
        const ids = s.columns.flat();
        const details = el('details', { class: 'vf-group vf-fold', open: open.has(s.id) || !many },
          el('summary', { class: 'vf-fold__head' },
            el('span', { class: 'tp-label vf-group__title' }, s.title || 'Untitled section'),
            el('span', { class: 'tp-dim vf-fold__count' }, `${ids.length} field${ids.length === 1 ? '' : 's'}`)),
          ids.map((id) => row(fields[id])));
        details.addEventListener('toggle', () => (details.open ? open.add(s.id) : open.delete(s.id)));
        return details;
      }),
    ].flat().filter(Boolean));
  }

  draw();
  return {
    node,
    /**
     * The sheet changed (designer edits): redraw, keeping what was filled in for
     * fields that still exist. With state.touched (a Set), fields not edited yet
     * follow the sheet's current defaults.
     */
    refresh(nextSheet) {
      sheet = nextSheet;
      const fields = fieldsInOrder(sheet);
      const ids = new Set(fields.map((f) => f.id));
      for (const k of Object.keys(state.values)) if (!ids.has(k)) delete state.values[k];
      if (state.touched) {
        for (const f of fields) {
          if (state.touched.has(f.id)) continue;
          if (f.default === undefined) delete state.values[f.id];
          else state.values[f.id] = structuredClone(f.default);
        }
      }
      draw();
    },
  };
}
