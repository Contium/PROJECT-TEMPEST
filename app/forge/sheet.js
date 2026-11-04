// Sheet renderer: draws a sheet (a preset, or an entity's snapshot of one) as
// the GM sees it or as the players will. The designer previews presets with it;
// character and story pages draw forged entities. The top of the sheet follows
// the preset's kind: image, category badge, name, the kind's facts (Species ·
// Size, or Start – End), then the short description.
//
// Player view, per field visibility:
//   revealed  the contents
//   shown     the GM's player-facing text instead of the contents
//   rumored   the label, with the contents obscured (redacted bars, static, or custom text)
// GM view shows everything, marks Shown/Rumored fields, and lists GM-only references.

import { el } from '../ui.js';
import { PARENT_TYPES, STAT_KINDS, categoriesOf, kindOf, formatDate } from './preset-model.js';

/**
 * renderSheet(sheet, { view: 'gm' | 'player', values?, shown?, refs?, lookup?, imageUrl?, pushImage?, preview? })
 *   values    { [fieldId]: value }; missing values fall back to the field's default
 *   shown     { [fieldId]: text } per-character "players read" text (else the preset's)
 *   refs      { [fieldId]: [id] } GM-only references
 *   lookup    (id) → { name, href, image? } | null, for links of every kind (parents, references,
 *             characters, locations)
 *   imageUrl  (assetId) → URL, for image and gallery values
 *   pushImage (assetId, caption) → void: GM view only; each picture gets a Push button (player screen)
 *   openImage ([{ image, caption }], index) → void: pictures open full size when clicked (a gallery
 *             passes all its images, so the viewer can step through them)
 *   preview   draw placeholder art in empty image slots (the designer's preview)
 */
export function renderSheet(preset, opts = {}) {
  const view = opts.view === 'player' ? 'player' : 'gm';
  const ctx = { ...opts, view, values: opts.values ?? {}, sheet: preset };
  const f = (id) => preset.fields[id];
  const facts = kindOf(preset).facts;
  const extra = preset.layout.main.map((id) => block(f(id), ctx)).filter(Boolean);
  return el('article', { class: `sheet sheet--${view}` },
    el('section', { class: 'sheet__main' },
      el('div', { class: 'sheet__portrait' }, block(f('image'), ctx, { bare: true })),
      el('div', { class: 'sheet__identity' },
        block(f('category'), ctx, { as: 'category' }),
        block(f('name'), ctx, { as: 'name' }),
        el('div', { class: 'sheet__facts' }, facts.map((id) => block(f(id), ctx))),
        block(f('summary'), ctx)),
      extra.length ? el('div', { class: 'sheet__main-extra' }, extra) : null),
    preset.layout.sections.map((s) =>
      el('section', { class: 'sheet__section' },
        s.title ? el('h3', { class: 'tp-h3 sheet__section-title' }, s.title) : null,
        el('div', { class: `sheet__columns sheet__columns--${s.columns.length}` },
          s.columns.map((col) => el('div', { class: 'sheet__column' }, col.map((id) => block(f(id), ctx))))))));
}

const valueOf = (field, ctx) => (field.id in ctx.values ? ctx.values[field.id] : field.default);

/** One field: label + contents, with the visibility rules applied. */
function block(field, ctx, { bare = false, as } = {}) {
  if (!field) return null;
  const gm = ctx.view === 'gm';
  const vis = field.visibility;
  const shownText = ctx.shown?.[field.id] ?? field.shown;
  let body;
  if (gm || vis === 'revealed') body = contents(field, valueOf(field, ctx), ctx, as);
  else if (vis === 'shown') body = shownText ? el('p', { class: 'sheet__shown' }, shownText) : el('p', { class: 'sheet__empty' }, '—');
  else body = obscured(field, as);

  const marks = gm
    ? [
        vis !== 'revealed' ? el('span', { class: `sheet__mark sheet__mark--${vis}`, title: vis === 'shown' ? `Players read: ${shownText || '(nothing written yet)'}` : 'Players see only that something is here' }, vis === 'shown' ? 'Shown' : 'Rumored') : null,
        field.references ? el('span', { class: 'sheet__mark sheet__mark--refs', title: 'GM-only links to other entities' }, 'Refs') : null,
      ]
    : [];
  const label = as === 'name' || as === 'category' || (bare && !marks.some(Boolean))
    ? null
    : el('span', { class: 'sheet__label' }, el('span', { class: 'tp-label' }, bare ? '' : field.label), marks);
  return el('div', { class: `sheet__field sheet__field--${field.type} ${as === 'name' ? 'sheet__field--name' : ''}`, 'data-field': field.id },
    label,
    (as === 'name' || as === 'category') && marks.some(Boolean) ? el('span', { class: 'sheet__label sheet__label--float' }, marks) : null,
    body,
    gm && field.references ? references(ctx.refs?.[field.id] ?? [], ctx) : null);
}

/** GM-only links to other entries, attached to a field. */
function references(ids, ctx) {
  const links = ids.map((id) => ctx.lookup?.(id)).filter(Boolean);
  return el('div', { class: 'sheet__refs' },
    el('span', { class: 'tp-dim' }, 'References (GM only): '),
    links.length
      ? links.map((r, i) => [i ? ', ' : '', r.href ? el('a', { class: 'app-link', href: r.href }, r.name) : r.name])
      : el('span', { class: 'tp-dim' }, ctx.preview ? 'linked per character' : 'none'));
}

/** Rumored contents: the players know something is there, not what. */
function obscured(field, as) {
  const style = field.rumor?.style ?? 'redacted';
  if (style === 'text') return el('p', { class: 'sheet__rumor-text' }, field.rumor.text || '???');
  if (style === 'static') return el('span', { class: `sheet__static ${as === 'name' ? 'sheet__static--name' : ''}`, role: 'img', 'aria-label': 'Unknown' });
  const bars = as === 'name' ? [70] : as === 'category' ? [18] : field.type === 'longtext' ? [92, 100, 64] : [field.type === 'stat' ? 45 : 60];
  return el('span', { class: `sheet__redacted ${as === 'name' ? 'sheet__redacted--name' : ''}`, role: 'img', 'aria-label': 'Redacted' },
    bars.map((w) => el('i', { style: `width:${w}%` })));
}

function contents(field, value, ctx, as) {
  const empty = (text = '—') => el('p', { class: 'sheet__empty' }, text);
  switch (field.type) {
    case 'text':
    case 'shorttext':
      if (as === 'name') return el('h2', { class: 'tp-h1 sheet__name' }, value || (ctx.preview ? 'Name' : '—'));
      return value ? el('p', { class: 'sheet__text' }, value) : empty(ctx.preview ? `${field.label}` : '—');
    case 'longtext':
      return value ? el('p', { class: 'sheet__text sheet__text--long' }, value) : empty(ctx.preview ? 'Text goes here.' : '—');
    case 'size':
      return el('span', { class: 'tp-badge sheet__size' }, value || 'Medium');
    case 'category':
      return el('span', { class: 'tp-badge tp-badge--interactive sheet__category' }, categoriesOf(ctx.sheet).find((c) => c.id === value)?.label ?? '—');
    case 'date':
      return value ? el('p', { class: 'sheet__text sheet__date tp-mono' }, formatDate(value)) : empty(field.id === 'end' ? 'Ongoing' : ctx.preview ? 'Not set' : '—');
    case 'cast':
      return cast(field, value, ctx);
    case 'location':
      return location(field, value, ctx);
    case 'image':
      return picture(value, ctx, field.primary ? 'sheet__image sheet__image--primary' : 'sheet__image', ctx.values?.name ? `${ctx.values.name} · ${field.label}` : field.label);
    case 'gallery':
      return gallery(field, value, ctx);
    case 'parent': {
      const type = PARENT_TYPES.find((t) => t.id === field.parentType)?.label ?? 'Entry';
      const parent = value?.id ? ctx.lookup?.(value.id) : null;
      return el('p', { class: 'sheet__parent' }, field.parentType === 'any' ? null : el('span', { class: 'tp-badge' }, type),
        parent ? (parent.href ? el('a', { class: 'app-link', href: parent.href }, parent.name) : el('span', {}, parent.name))
          : el('span', { class: 'tp-dim' }, value?.id ? 'No longer exists' : 'None'));
    }
    case 'stat':
    case 'rarity':
      return stat(field, value);
    default:
      return empty();
  }
}

function picture(assetId, ctx, cls, alt, set) {
  if (assetId && ctx.imageUrl) {
    const items = set ?? [{ image: assetId, caption: alt }];
    const open = ctx.openImage ? () => ctx.openImage(items, Math.max(0, items.findIndex((x) => x.image === assetId))) : null;
    const img = el('img', { class: `${cls}${open ? ' sheet__zoomable' : ''}`, src: ctx.imageUrl(assetId), alt, title: open ? 'Open full size' : null, onClick: open });
    if (ctx.view !== 'gm' || !ctx.pushImage) return img;
    return el('span', { class: 'sheet__pushable' }, img,
      el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive sheet__push', title: 'Show this picture on the player screen', onClick: () => ctx.pushImage(assetId, alt) }, '⇪ Push'));
  }
  return el('div', { class: `${cls} sheet__placeholder`, role: 'img', 'aria-label': `${alt} (no image yet)` }, el('span', {}, '◇'));
}

/** Pool / fixed / flexible pool / rarity. */
function stat(field, v) {
  const kind = field.stat;
  if (kind === 'rarity') {
    const r = field.rarities.find((x) => x.id === v?.rarity) ?? field.rarities[0];
    return r ? rarityBadge(r) : el('p', { class: 'sheet__empty' }, '—');
  }
  if (kind === 'fixed') return el('p', { class: 'sheet__number tp-mono' }, String(v?.value ?? 0));
  const value = v?.value ?? 0;
  const max = v?.max ?? 0;
  const over = kind === 'flex' && value > max ? value - max : 0;
  // Over the limit, the bar spans the whole value: the limit's share, then the overflow after it.
  const fill = over ? max / value : max > 0 ? Math.min(value, max) / max : 0;
  return el('div', { class: `sheet__pool ${over ? 'is-over' : ''}`, title: STAT_KINDS.find((k) => k.id === kind)?.label },
    el('span', { class: 'sheet__bar' },
      el('i', { class: 'sheet__bar-fill', style: `width:${fill * 100}%` }),
      over ? el('i', { class: 'sheet__bar-over', style: `width:${(over / value) * 100}%` }) : null),
    el('span', { class: 'sheet__pool-nums tp-mono' }, `${value} / ${max}`, over ? el('b', {}, ` +${over}`) : null));
}

/** A link to another entity (or its name, or a note that it's gone). */
function entityLink(id, ctx) {
  const e = id ? ctx.lookup?.(id) : null;
  if (!e) return el('span', { class: 'tp-dim' }, id ? 'No longer exists' : 'None');
  return e.href ? el('a', { class: 'app-link', href: e.href }, e.name) : el('span', {}, e.name);
}

/** Characters field: the sides of a fight side by side, or everyone involved with their notes. */
function cast(field, v, ctx) {
  if (field.mode === 'combat') {
    const sides = field.sides.map((name, i) => v?.sides?.[i] ?? { name, faction: '', members: [] });
    return el('div', { class: `sheet__sides sheet__sides--${sides.length}` },
      sides.map((s, i) =>
        el('div', { class: 'sheet__side', style: `--side:${i}` },
          el('p', { class: 'sheet__side-name' }, s.name || field.sides[i]),
          s.faction ? el('p', { class: 'sheet__side-faction', title: 'Faction (linkable once factions exist)' }, s.faction) : null,
          s.members.length
            ? el('ul', { class: 'sheet__list' }, s.members.map((id) => el('li', {}, entityLink(id, ctx))))
            : el('p', { class: 'sheet__empty' }, ctx.preview ? 'Fighters go here' : 'No one yet'))));
  }
  const people = v?.people ?? [];
  if (!people.length) return el('p', { class: 'sheet__empty' }, ctx.preview ? 'Characters go here' : '—');
  return el('ul', { class: 'sheet__list sheet__involved' },
    people.map((p) => el('li', {}, entityLink(p.id, ctx), p.note ? el('span', { class: 'sheet__note' }, p.note) : null)));
}

/**
 * Location field. Direct: the location's picture (once locations exist, and
 * only once the GM reveals it). Indirect: a link to whatever stands for the
 * place. Obscure: an empty picture frame with a short description.
 */
function location(field, v, ctx) {
  if (field.mode === 'obscure') {
    return el('div', { class: 'sheet__place' },
      el('div', { class: 'sheet__image sheet__placeholder sheet__place-frame', role: 'img', 'aria-label': 'An unknown place' }, el('span', {}, '?')),
      v?.text ? el('p', { class: 'sheet__text' }, v.text) : el('p', { class: 'sheet__empty' }, ctx.preview ? 'A short description of the place' : '—'));
  }
  if (field.mode === 'indirect') return el('p', { class: 'sheet__parent' }, entityLink(v?.id, ctx));
  const place = v?.id ? ctx.lookup?.(v.id) : null;
  const showImage = place?.image && (ctx.view === 'gm' || place.imageRevealed);
  return el('div', { class: 'sheet__place' },
    showImage ? picture(place.image, ctx, 'sheet__image', place.name) : el('div', { class: 'sheet__image sheet__placeholder sheet__place-frame', role: 'img', 'aria-label': 'No location image' }, el('span', {}, '◇')),
    el('p', { class: 'sheet__parent' }, v?.id ? entityLink(v.id, ctx) : el('span', { class: 'tp-dim' }, ctx.preview ? 'A location (once Locations exist)' : 'None')));
}

export function rarityBadge(r) {
  return el('span', { class: `sheet__rarity sheet__rarity--${r.style}`, style: `--rarity:${r.color}` }, r.name);
}

// --- galleries -------------------------------------------------------------------------------

/** Floors (▲▼), slideshow (◀▶, optionally cycling) or a cols×rows grid. */
function gallery(field, images, ctx) {
  const list = Array.isArray(images) && images.length ? images : null;
  const count = list ? list.length : field.mode === 'grid' ? field.cols * field.rows : 3;
  const set = list?.map((x, j) => ({ image: x?.image ?? x, caption: x?.label || `${field.label} ${j + 1}` }));
  const slide = (i) => (list ? picture(set[i].image, ctx, 'sheet__slide', set[i].caption, set) : placeholderTile(i));

  if (field.mode === 'grid') {
    return el('div', { class: 'sheet__grid', style: `--cols:${field.cols};--rows:${field.rows}` },
      Array.from({ length: Math.min(count, field.cols * field.rows) }, (_, i) => slide(i)));
  }

  const floors = field.mode === 'floors';
  let index = 0;
  const frame = el('div', { class: 'sheet__viewer-frame' }, slide(0));
  const counter = el('span', { class: 'sheet__viewer-count tp-mono' });
  const show = (i) => {
    index = (i + count) % count;
    frame.replaceChildren(slide(index));
    counter.textContent = floors ? `Floor ${index + 1} / ${count}` : `${index + 1} / ${count}`;
  };
  // Floors read bottom-up: ▲ goes one floor up.
  const prev = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': floors ? 'Floor down' : 'Previous image', onClick: () => show(index - 1) }, floors ? '▼' : '◀');
  const next = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', 'aria-label': floors ? 'Floor up' : 'Next image', onClick: () => show(index + 1) }, floors ? '▲' : '▶');
  show(0);
  const node = el('div', { class: `sheet__viewer sheet__viewer--${field.mode}` },
    frame,
    el('div', { class: 'sheet__viewer-controls' }, floors ? [next, counter, prev] : [prev, counter, next],
      !floors && field.autoplay ? el('span', { class: 'tp-dim sheet__viewer-auto' }, `cycles every ${field.interval}s`) : null));

  if (!floors && field.autoplay && count > 1) {
    // Stops by itself once the sheet is replaced or removed; pauses while hovered.
    const timer = setInterval(() => {
      if (!node.isConnected) return clearInterval(timer);
      if (!node.matches(':hover')) show(index + 1);
    }, field.interval * 1000);
  }
  return node;
}

function placeholderTile(i) {
  return el('div', { class: 'sheet__slide sheet__placeholder', role: 'img', 'aria-label': `Image ${i + 1} (placeholder)`, style: `--tile:${i}` }, el('span', {}, String(i + 1)));
}
