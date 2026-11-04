// Entity browser: searchable list + detail (fields, relations, history) + editor.

import { el, frame, panelHead, tierBadge, visibilityBadge, emptyState, toast, toastError, confirmDialog, debounce } from '../ui.js';
import { formatGameTime } from '../time.js';
import { buildEditor } from './editor.js';
import { ancestors, children, backlinks } from '../model.js';
import { pushEntity, pushRoster, pushImage } from '../push.js';
import { renderArticle } from '../article.js';
import { mapViewer } from '../map-viewer.js';
import { recordRecent } from '../palette.js';
import { formatGameDate } from '../time.js';

const RELATION_KINDS = ['controls', 'allied with', 'rival of', 'mentor of', 'married to', 'owes a favour to', 'employs', 'protects', 'hunts', 'distrusts'];
const OP_LABEL = { create: 'Created', update: 'Changed', delete: 'Removed', restore: 'Restored' };
const VIS_LABEL = { hidden: 'GM only', rumored: 'Rumoured', known: 'Known' };

export async function mount(root, ctx) {
  let typeId = ctx.params.type;
  let selected = ctx.params.id === 'new' ? null : ctx.params.id ?? null;
  let mode = ctx.params.id === 'new' ? 'new' : 'view';
  let q = '';
  let showDeleted = false;
  let items = [];

  const type = () => {
    const t = ctx.type(typeId);
    if (!t) throw Object.assign(new Error(`Unknown type "${typeId}"`), { status: 404 });
    return t;
  };
  type();

  const base = () => `${ctx.base}/e/${typeId}`;
  const listHost = el('ul', { class: 'ent__list', role: 'list' });
  const countBadge = el('span', { class: 'tp-deco' });
  const titleNode = el('h2', { class: 'tp-panel__title' });
  const search = el('input', { class: 'tp-input', type: 'search', placeholder: 'Search…', 'aria-label': 'Search' });
  const deletedToggle = el('input', { type: 'checkbox' });
  const detail = el('article', { class: 'tp-frame tp-panel ent__detail' });

  search.addEventListener('input', debounce(() => ((q = search.value.trim()), loadList()), 180));
  deletedToggle.addEventListener('change', () => ((showDeleted = deletedToggle.checked), loadList()));

  root.append(
    el(
      'div',
      { class: 'ent' },
      el(
        'article',
        { class: 'tp-frame tp-panel' },
        el('header', { class: 'tp-panel__head' }, titleNode, countBadge),
        el(
          'div',
          { class: 'ent__list-tools' },
          search,
          el('div', { class: 'app-row' },
            el('label', { class: 'tp-check' }, deletedToggle, el('span', { class: 'tp-muted' }, 'Show removed')),
            el('button', {
              class: 'tp-frame tp-btn tp-btn--interactive tp-btn--sm', style: 'margin-left:auto',
              title: 'Show everything players know of this kind on the player screen', onClick: () => pushRoster(ctx, typeId),
            }, 'Push list'),
            el('a', { class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', href: ctx.href(`${base()}/new`) }, '+ New'),
          ),
        ),
        listHost,
      ),
      detail,
    ),
  );

  // --- List ---------------------------------------------------------------------

  function subtitle(e) {
    const d = e.data;
    const text = d.role ?? d.kind ?? d.summary ?? d.rumor ?? '';
    return text.split('\n')[0];
  }

  function paintList() {
    titleNode.textContent = ctx.typeLabel(type(), true);
    countBadge.textContent = `${items.length} ${q ? 'FOUND' : 'TRACKED'}`;
    listHost.replaceChildren(
      ...(items.length
        ? items.map((e) =>
            el(
              'li',
              {},
              el(
                'a',
                { class: `ent__item ${e.deleted ? 'is-deleted' : ''} ${e.data.image ? 'has-thumb' : ''}`, href: ctx.href(`${base()}/${e.id}`), 'aria-current': e.id === selected ? 'true' : null },
                e.data.image ? el('img', { class: 'ent__thumb', src: ctx.api.imageUrl(e.data.image), alt: '', loading: 'lazy' }) : null,
                el('span', { class: 'ent__item-text' },
                  el('span', { class: 'ent__item-top' }, el('span', { class: 'ent__item-name' }, e.name), visibilityBadge(e.visibility), tierBadge(e.data.tier ?? e.data.severity)),
                  subtitle(e) ? el('span', { class: 'ent__item-sub' }, subtitle(e)) : null),
              ),
            ),
          )
        : [el('li', {}, emptyState(q ? 'No matches' : 'None yet', q ? null : `Create the first ${ctx.typeLabel(type()).toLowerCase()} with + New.`))]),
    );
  }

  async function loadList() {
    items = await ctx.api.list({ type: typeId, q: q || undefined, includeDeleted: showDeleted || undefined, sort: typeId === 'event' ? 'created' : 'name' });
    if (typeId === 'era') items.sort((a, b) => a.data.start - b.data.start); // eras read in Time-Line order
    paintList();
  }

  // --- Detail ---------------------------------------------------------------------

  function link(id, names) {
    const target = names.get(id);
    if (!target) return el('span', { class: 'tp-dim' }, id);
    return el('a', { class: 'app-link', href: ctx.entityHref(target) }, target.name);
  }

  function breadcrumbs(entity, names) {
    const chain = ancestors(entity, names);
    if (!chain.length) return null;
    return el('nav', { class: 'ent__crumbs', 'aria-label': 'Located in' },
      chain.flatMap((a, i) => [i ? el('span', { class: 'tp-dim', 'aria-hidden': 'true' }, '›') : null, link(a.id, names)]));
  }

  /** Groups of linked entities as labelled rows of links. */
  function linkGroups(title, groups, emptyText) {
    if (!groups.length) return emptyText ? el('section', { class: 'ent__section' }, el('header', {}, el('h3', { class: 'tp-label' }, title)), el('p', { class: 'tp-muted' }, emptyText)) : null;
    return el(
      'section',
      { class: 'ent__section' },
      el('header', {}, el('h3', { class: 'tp-label' }, title)),
      el('dl', { class: 'ent__links' },
        groups.map((g) =>
          el('div', { class: 'ent__link-row' },
            el('dt', { class: 'tp-label' }, g.label),
            el('dd', {}, g.entities.flatMap((e, i) => [i ? ', ' : null, el('a', { class: 'app-link', href: ctx.entityHref(e) }, e.name), visibilityBadge(e.visibility) ? ' ' : null, visibilityBadge(e.visibility)]))))),
    );
  }

  function containsSection(entity, names) {
    const groups = children(entity.id, names, ctx.types).map((g) => ({ label: `${ctx.typeLabel(g.type, true)} (${g.entities.length})`, entities: g.entities }));
    return linkGroups('Contains', groups);
  }

  function linkedFromSection(entity, names) {
    const groups = backlinks(entity.id, names, ctx.types).map((g) => ({
      label: `${ctx.typeLabel(g.type, true)} · ${ctx.fieldLabel(g.field)}`,
      entities: g.entities,
    }));
    return linkGroups('Linked from', groups);
  }

  /** Revealed scene images beside a screamsheet, as players get them. */
  function articleAside(entity) {
    const shown = (entity.data.maps ?? []).filter((m) => m.revealed);
    if (!shown.length) return null;
    return mapViewer({
      maps: shown,
      url: ctx.api.imageUrl,
      labels: { prev: '◀', next: '▶', prevTitle: 'Previous image', nextTitle: 'Next image', fallback: (i) => `Image ${i + 1}` },
    }).node;
  }

  async function toggleReveal(entity, field, index) {
    const maps = entity.data[field.key].map((item, i) => (i === index ? { ...item, revealed: !item.revealed } : item));
    const item = maps[index];
    const label = item.label || `${ctx.fieldLabel(field)} ${index + 1}`;
    try {
      const res = await ctx.api.batch({
        note: `${item.revealed ? 'Revealed' : 'Hid'} "${label}" (${entity.name})`,
        ops: [{ op: 'update', id: entity.id, data: { [field.key]: maps } }],
      });
      const unseen = item.revealed && entity.visibility === 'hidden';
      toast(item.revealed ? `${label} revealed` : `${label} hidden from players`, {
        tone: 'success',
        details: unseen ? [`Players won't see it until ${entity.name} itself is revealed`] : [],
        action: { label: 'Undo', run: () => ctx.api.undo(res.batch).catch(toastError) },
      });
      await renderDetail();
    } catch (err) {
      toastError(err);
    }
  }

  function formatValue(field, value, names, entity) {
    switch (field?.type) {
      case 'gallery':
        return el('div', { class: 'ent__gallery' },
          value.map((item, i) => {
            const label = item.label || `${ctx.fieldLabel(field)} ${i + 1}`;
            return el('figure', { class: 'ent__gallery-item' },
              el('img', { src: ctx.api.imageUrl(item.image), alt: label, loading: 'lazy' }),
              el('figcaption', { class: 'app-row' },
                el('span', {}, label),
                item.revealed ? el('span', { class: 'tp-badge tp-badge--success' }, 'Revealed') : el('span', { class: 'tp-badge tp-badge--danger' }, 'GM only')),
              el('div', { class: 'app-row' },
                el('button', {
                  class: 'tp-frame tp-btn tp-btn--interactive tp-btn--sm', title: 'Show this map full-screen on the player screen',
                  onClick: () => pushImage(ctx, item.image, `${entity.name}: ${label}`),
                }, 'Push'),
                el('button', {
                  class: 'tp-frame tp-btn tp-btn--sm',
                  title: item.revealed ? 'Remove it from what players see' : 'Include it in what players see of this entity',
                  onClick: () => toggleReveal(entity, field, i),
                }, item.revealed ? 'Hide' : 'Reveal')));
          }));
      case 'image':
        return el('figure', { class: 'ent__image' },
          el('img', { src: ctx.api.imageUrl(value), alt: `${ctx.fieldLabel(field)} of ${entity.name}` }),
          el('button', {
            class: 'tp-frame tp-btn tp-btn--interactive tp-btn--sm', title: 'Show this image full size on the player screen',
            onClick: () => pushImage(ctx, value, entity.name),
          }, 'Push image'));
      case 'ref':
        return link(value, names);
      case 'refs':
        return value.flatMap((id, i) => (i ? [', ', link(id, names)] : [link(id, names)]));
      case 'tags':
        return el('span', { class: 'app-row' }, value.map((t) => el('span', { class: 'tp-badge' }, t)));
      case 'tier':
        return tierBadge(value);
      case 'meter':
        return el('span', { class: 'app-row' }, el('span', { class: 'tp-meter', style: `--value:${value};flex:1` }), `${Math.round(value * 100)}%`);
      case 'bool':
        return value ? 'Yes' : 'No';
      case 'gametime':
        return formatGameTime(value, ctx.meta.calendar);
      case 'number':
        return Number(value).toLocaleString();
      case 'enum':
        return String(value)[0].toUpperCase() + String(value).slice(1);
      default:
        return Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  function shortValue(key, value, names) {
    if (value == null) return '∅';
    if (key === 'visibility') return VIS_LABEL[value] ?? value;
    if (key === 'secretFields') return value.length ? value.join(', ') : 'none';
    const field = type().fields.find((f) => `data.${f.key}` === key);
    if (field?.type === 'ref') return names.get(value)?.name ?? value;
    if (field?.type === 'refs') return value.map((id) => names.get(id)?.name ?? id).join(', ');
    if (field?.type === 'meter') return `${Math.round(value * 100)}%`;
    if (field?.type === 'gallery') {
      const revealed = value.filter((item) => item.revealed).map((item) => item.label || 'untitled');
      return `${value.length} map${value.length === 1 ? '' : 's'}${revealed.length ? ` (revealed: ${revealed.join(', ')})` : ''}`;
    }
    if (field?.type === 'gametime') return formatGameTime(value, ctx.meta.calendar);
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

  function keyLabel(key) {
    if (key === 'name') return 'Name';
    if (key === 'visibility') return 'Visibility';
    if (key === 'secretFields') return 'Secret fields';
    const field = type().fields.find((f) => `data.${f.key}` === key);
    return field ? ctx.fieldLabel(field) : key.replace(/^data\./, '');
  }

  function fieldsSection(entity, names) {
    const t = type();
    const declared = new Set(t.fields.map((f) => f.key));
    const secretKeys = new Set([...t.fields.filter((f) => f.secret).map((f) => f.key), ...entity.secretFields]);
    const rows = [
      ...t.fields.filter((f) => entity.data[f.key] != null && !(Array.isArray(entity.data[f.key]) && !entity.data[f.key].length)),
      ...Object.keys(entity.data).filter((k) => !declared.has(k)).map((k) => ({ key: k, label: k.replace(/_/g, ' '), type: typeof entity.data[k] === 'number' ? 'number' : 'text', custom: true })),
    ];
    if (!rows.length) return el('p', { class: 'tp-muted' }, 'No details yet. Use Edit to fill them in.');
    return el(
      'dl',
      { class: 'ent__fields' },
      rows.map((field) =>
        el(
          'div',
          { class: `ent__field ${field.type === 'longtext' || field.type === 'gallery' ? 'ent__field--wide' : ''} ${field.type === 'image' ? 'ent__field--image' : ''}` },
          el('dt', { class: 'tp-label' }, field.custom ? field.label : ctx.fieldLabel(field),
            secretKeys.has(field.key) ? el('span', { class: 'tp-badge tp-badge--danger' }, 'GM only') : null,
            field.custom ? el('span', { class: 'tp-badge' }, 'Custom') : null),
          el('dd', {}, formatValue(field, entity.data[field.key], names, entity)),
        ),
      ),
    );
  }

  function relationsSection(entity, relations, names) {
    const rows = relations.map((r) => {
      const outgoing = r.data.from === entity.id;
      const other = outgoing ? r.data.to : r.data.from;
      const v = r.data.value;
      const value =
        v == null ? el('span') : v >= 0 && v <= 1 ? el('span', { class: 'app-row' }, el('span', { class: 'tp-meter', style: `--value:${v};flex:1` }), el('span', { class: 'tp-mono' }, `${Math.round(v * 100)}%`)) : el('span', { class: 'tp-mono' }, v);
      return el(
        'div',
        { class: 'ent__rel' },
        el('span', { class: 'tp-label' }, outgoing ? r.data.kind : `← ${r.data.kind}`),
        el('span', {}, link(other, names), ' ', visibilityBadge(r.visibility)),
        value,
        el('button', { class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', title: 'Remove relation', onClick: () => removeRelation(r) }, '×'),
      );
    });

    const kind = el('input', { class: 'tp-input', list: 'rel-kinds', placeholder: 'kind, e.g. controls', required: true });
    const direction = el('select', { class: 'tp-select' }, el('option', { value: 'out' }, `${entity.name} →`), el('option', { value: 'in' }, `→ ${entity.name}`));
    const target = el(
      'select',
      { class: 'tp-select', required: true },
      el('option', { value: '' }, 'Choose…'),
      [...names.values()]
        .filter((e) => !e.deleted && e.type !== 'relation' && e.id !== entity.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => el('option', { value: e.id }, `${e.name} (${ctx.typeLabel(e.type)})`)),
    );
    const value = el('input', { class: 'tp-input', type: 'number', step: 'any', placeholder: 'value (0.62 = 62%)' });
    const visible = el('input', { type: 'checkbox' });
    const relLabel = ctx.typeLabel('relation');
    const form = el(
      'form',
      { class: 'app-stack', hidden: true },
      el('datalist', { id: 'rel-kinds' }, RELATION_KINDS.map((k) => el('option', { value: k }))),
      el('div', { class: 'app-row' }, direction, kind, target, value),
      el('div', { class: 'app-row' },
        el('label', { class: 'tp-check' }, visible, el('span', {}, 'Players can see it')),
        el('button', { class: 'tp-frame tp-btn tp-btn--interactive tp-btn--sm', style: 'margin-left:auto' }, `Add ${relLabel.toLowerCase()}`)),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!target.value || !kind.value.trim()) return toast('Pick a kind and a target', { tone: 'warning' });
      const [from, to] = direction.value === 'out' ? [entity.id, target.value] : [target.value, entity.id];
      const label = `${names.get(from)?.name} ${kind.value.trim()} ${names.get(to)?.name}`;
      try {
        await ctx.api.batch({
          note: label,
          ops: [{
            op: 'create', type: 'relation', name: label, visibility: visible.checked ? 'known' : 'hidden',
            data: { from, to, kind: kind.value.trim(), value: value.value === '' ? null : Number(value.value) },
          }],
        });
        toast(`${relLabel} added`, { tone: 'success' });
        await renderDetail();
      } catch (err) {
        toastError(err);
      }
    });

    return el(
      'section',
      { class: 'ent__section' },
      el('header', {}, el('h3', { class: 'tp-label' }, ctx.typeLabel('relation', true)),
        el('button', { class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', onClick: () => (form.hidden = !form.hidden) }, '+ Add')),
      rows.length ? rows : el('p', { class: 'tp-muted' }, `No ${ctx.typeLabel('relation', true).toLowerCase()} yet.`),
      form,
    );
  }

  async function removeRelation(r) {
    try {
      const res = await ctx.api.batch({ note: `Removed: ${r.name}`, ops: [{ op: 'delete', id: r.id }] });
      toast(`${ctx.typeLabel('relation')} removed`, { tone: 'success', action: { label: 'Undo', run: () => ctx.api.undo(res.batch).then(renderDetail, toastError) } });
      await renderDetail();
    } catch (err) {
      toastError(err);
    }
  }

  function historySection(entity, history, names) {
    const rows = [...history].reverse().map((h) =>
      el(
        'div',
        { class: `ent__history-item ${h.undone ? 'is-undone' : ''}` },
        el('div', { class: 'ent__history-head' },
          el('span', { class: 'tp-mono tp-dim' }, h.gameTimeLabel),
          el('strong', {}, OP_LABEL[h.op]),
          h.note ? el('span', { class: 'tp-muted' }, `· ${h.note}`) : null,
          // Link the causing event, unless it's this entity, not yet in the world (scheduled), or already named by the note.
          h.eventId && h.eventId !== entity.id && names.has(h.eventId) && names.get(h.eventId).name !== h.note
            ? el('span', { class: 'tp-muted' }, '· ', link(h.eventId, names))
            : null,
          h.gameTime > ctx.meta.clock ? el('span', { class: 'tp-badge tp-badge--interactive' }, 'Scheduled') : null,
          h.undone ? el('span', { class: 'tp-badge' }, 'Undone') : null,
          el('button', {
            class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', style: 'margin-left:auto',
            onClick: async () => {
              try {
                await (h.undone ? ctx.api.redo(h.batch) : ctx.api.undo(h.batch));
                await update();
              } catch (err) {
                toastError(err);
              }
            },
          }, h.undone ? 'Redo' : 'Undo'),
        ),
        h.op === 'update'
          ? el('ul', { class: 'ent__diff' }, Object.entries(h.patch).map(([k, v]) => el('li', {}, `${keyLabel(k)}: ${shortValue(k, h.prior?.[k], names)} → ${shortValue(k, v, names)}`)))
          : null,
      ),
    );
    return el('section', { class: 'ent__section' }, el('header', {}, el('h3', { class: 'tp-label' }, 'History'), el('span', { class: 'tp-deco' }, `${history.length} CHANGES`)), rows);
  }

  async function setDeleted(entity, deleted) {
    if (deleted) {
      const ok = await confirmDialog({
        title: `Remove ${entity.name}?`,
        body: 'It disappears from the world from now on. History keeps it, and you can restore it any time.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await ctx.api.batch({ note: `${deleted ? 'Removed' : 'Restored'} ${entity.name}`, ops: [{ op: deleted ? 'delete' : 'restore', id: entity.id }] });
      toast(deleted ? `${entity.name} removed` : `${entity.name} restored`, {
        tone: 'success',
        action: { label: 'Undo', run: () => ctx.api.undo(res.batch).catch(toastError) },
      });
      if (deleted && !showDeleted) ctx.go(base());
      await update();
    } catch (err) {
      toastError(err);
    }
  }

  async function renderDetail() {
    if (mode === 'new' || mode === 'edit') {
      const entity = mode === 'edit' ? await ctx.api.get(selected) : null;
      const editor = await buildEditor({
        ctx,
        type: type(),
        entity,
        onDone: (id) => {
          mode = 'view';
          if (id && id !== selected) ctx.go(`${base()}/${id}`);
          else if (!id && !selected) ctx.go(base());
          else renderDetail();
          loadList();
        },
      });
      detail.replaceChildren(
        panelHead(entity ? `Edit: ${entity.name}` : `New ${ctx.typeLabel(type())}`, el('span', { class: 'tp-deco' }, entity ? entity.id.toUpperCase() : 'UNSAVED')),
        el('div', { class: 'tp-panel__body' }, editor),
      );
      return;
    }

    if (!selected) {
      detail.replaceChildren(
        emptyState(
          `${ctx.typeLabel(type(), true)}`,
          items.length ? 'Pick one from the list to see its details, relations and history.' : null,
          el('a', { class: 'tp-frame tp-btn tp-btn--primary', href: ctx.href(`${base()}/new`) }, `+ New ${ctx.typeLabel(type())}`),
        ),
      );
      return;
    }

    let entity;
    try {
      entity = await ctx.api.get(selected);
    } catch (err) {
      if (err.status !== 404) throw err;
      detail.replaceChildren(emptyState('Not in the world right now', 'It may be scheduled for later in the timeline, or its creation was undone.'));
      return;
    }
    const [relations, history, names] = await Promise.all([ctx.api.relations(entity.id), ctx.api.history(entity.id), ctx.names()]);
    recordRecent(ctx.uid, entity.id); // feeds Quick search's "Recent" list
    const isRelation = entity.type === 'relation';
    detail.replaceChildren(
      el(
        'header',
        { class: 'tp-panel__head' },
        el('div', { class: 'ent__title' },
          breadcrumbs(entity, names),
          el('h2', { class: 'tp-panel__title' }, entity.name),
          el('span', { class: 'tp-deco' }, ctx.typeLabel(type())),
          visibilityBadge(entity.visibility) ?? el('span', { class: 'tp-badge tp-badge--success' }, 'Known'),
          ctx.display?.mode === 'entity' && ctx.display.id === entity.id ? el('span', { class: 'tp-badge tp-badge--interactive' }, 'On screen') : null,
          entity.deleted ? el('span', { class: 'tp-badge' }, 'Removed') : null),
        el('div', { class: 'app-row' },
          entity.deleted
            ? el('button', { class: 'tp-frame tp-btn tp-btn--interactive tp-btn--sm', onClick: () => setDeleted(entity, false) }, 'Restore')
            : [
                el('button', {
                  class: 'tp-frame tp-btn tp-btn--interactive tp-btn--sm',
                  title: entity.visibility === 'hidden' ? 'GM only: you will be asked to reveal it first' : 'Show this on the player screen',
                  onClick: () => pushEntity(ctx, entity),
                }, 'Push'),
                el('button', { class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', onClick: () => ((mode = 'edit'), renderDetail()) }, 'Edit'),
                el('button', { class: 'tp-frame tp-btn tp-btn--danger tp-btn--sm', onClick: () => setDeleted(entity, true) }, 'Remove'),
              ]),
      ),
      el('div', { class: 'tp-panel__body' },
        entity.type === 'article'
          ? el('section', { class: 'ent__section' }, el('header', {}, el('h3', { class: 'tp-label' }, 'As players see it')),
              renderArticle({
                headline: entity.name, outlet: entity.data.outlet, byline: entity.data.byline, layout: entity.data.layout, body: entity.data.body,
                imageUrl: entity.data.image ? ctx.api.imageUrl(entity.data.image) : null, dateLabel: formatGameDate(entity.createdAt, ctx.meta.calendar),
                aside: articleAside(entity),
              }))
          : null,
        fieldsSection(entity, names),
        entity.deleted ? null : containsSection(entity, names),
        entity.deleted || isRelation ? null : relationsSection(entity, relations, names),
        entity.deleted ? null : linkedFromSection(entity, names),
        historySection(entity, history, names)),
    );
    ctx.engine.applyLexicon(detail);
  }

  async function update() {
    await loadList();
    if (mode === 'view') await renderDetail();
  }

  await loadList();
  await renderDetail();

  return {
    update,
    relabel: () => (paintList(), mode === 'view' ? renderDetail() : null),
    onDisplay: () => (mode === 'view' ? renderDetail() : null), // refresh the "On screen" marker
    reroute(params) {
      if (params.type !== typeId) return false;
      mode = params.id === 'new' ? 'new' : 'view';
      selected = params.id === 'new' ? null : params.id ?? null;
      paintList();
      renderDetail().catch(toastError);
      return true;
    },
  };
}
