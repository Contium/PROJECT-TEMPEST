// Time-Line: every batch of changes, newest first, grouped by era and in-game day, with undo/redo.

import { el, frame, panelHead, toast, toastError, emptyState } from '../ui.js';
import { formatClockTime, formatGameDate, formatShortDate } from '../time.js';
import { eraAt } from '../model.js';

const VERB = { create: 'added', update: 'changed', delete: 'removed', restore: 'restored' };

function changeSummary(b, ctx, names) {
  const items = b.changes.slice(0, 5).map((c) => {
    const entity = names?.get(c.entity);
    const label = c.name ?? entity?.name ?? c.entity;
    const target = entity ? el('a', { class: 'app-link', href: ctx.entityHref(entity) }, label) : el('span', {}, label);
    return [el('span', { class: 'tp-dim' }, `${VERB[c.op]} `), target];
  });
  const more = b.changes.length > 5 ? ` and ${b.changes.length - 5} more` : '';
  return el('p', { class: 'tl-changes' }, items.flatMap((parts, i) => (i ? ['; ', ...parts] : parts)), more);
}

async function toggleUndo(b, ctx) {
  try {
    if (b.undone) await ctx.api.redo(b.batch);
    else await ctx.api.undo(b.batch);
    toast(b.undone ? 'Change restored' : 'Change undone', {
      tone: 'success',
      action: { label: b.undone ? 'Undo' : 'Redo', run: () => (b.undone ? ctx.api.undo(b.batch) : ctx.api.redo(b.batch)).catch(toastError) },
    });
  } catch (err) {
    toastError(err);
  }
}

/** One batch as a row. `compact` shows a short date and hides actions. */
export function timelineEntry(b, ctx, { compact = false, names } = {}) {
  const title = b.eventName ?? b.note ?? 'Edit';
  return el(
    'div',
    { class: `tl-item ${b.undone ? 'is-undone' : ''}` },
    el('time', { title: b.gameTimeLabel }, compact ? formatShortDate(b.gameTime, ctx.meta.calendar) : formatClockTime(b.gameTime)),
    el(
      'div',
      {},
      el(
        'p',
        { class: 'tl-title' },
        title,
        b.eventId ? el('span', { class: 'tp-badge tp-badge--primary' }, ctx.typeLabel('event')) : null,
        b.scheduled ? el('span', { class: 'tp-badge tp-badge--interactive' }, `Scheduled · ${b.gameTimeLabel}`) : null,
        b.undone ? el('span', { class: 'tp-badge' }, 'Undone') : null,
      ),
      b.eventName && b.note ? el('p', { class: 'tl-changes' }, b.note) : null,
      changeSummary(b, ctx, names),
    ),
    compact
      ? el('span')
      : el('button', { class: 'tp-frame tp-btn tp-btn--ghost tp-btn--sm', onClick: () => toggleUndo(b, ctx) }, b.undone ? 'Redo' : 'Undo'),
  );
}

export async function mount(root, ctx) {
  const page = el('div', { class: 'app-page' });
  root.append(page);

  async function render() {
    const [batches, names, eras] = await Promise.all([ctx.api.timeline({ limit: 1000 }), ctx.names(), ctx.eras()]);
    const cal = ctx.meta.calendar;

    // era → day → batches, preserving newest-first order
    const groups = [];
    for (const b of batches) {
      const era = eraAt(eras, b.gameTime);
      let eraGroup = groups.at(-1);
      if (!eraGroup || eraGroup.era?.id !== era?.id) groups.push((eraGroup = { era, days: [] }));
      const day = formatGameDate(b.gameTime, cal);
      let dayGroup = eraGroup.days.at(-1);
      if (!dayGroup || dayGroup.day !== day) eraGroup.days.push((dayGroup = { day, items: [] }));
      dayGroup.items.push(b);
    }

    const eraBanner = (era) =>
      el('div', { class: 'tl-era' },
        el('h2', { class: 'tp-h2' }, era ? el('a', { class: 'app-link', href: ctx.entityHref(era) }, era.name) : 'Outside any era'),
        era ? el('span', { class: 'tp-deco' }, `${formatGameDate(era.data.start, cal)} → ${era.data.end != null ? formatGameDate(era.data.end, cal) : 'NOW'}`) : null);

    page.replaceChildren(
      el('div', { class: 'app-page__head' },
        el('h1', { class: 'tp-h1' }, ctx.engine.t('timeline', 'Time-Line')),
        el('span', { class: 'tp-deco' }, `${batches.length} ENTRIES // NOW ${ctx.meta.clockLabel}${ctx.meta.era ? ` // ${ctx.meta.era.name}` : ''}`)),
      ...(groups.length
        ? groups.flatMap((g) => [
            eraBanner(g.era),
            ...g.days.map((d) =>
              frame('', panelHead(d.day, el('span', { class: 'tp-deco' }, `${d.items.length} ENTRIES`)),
                el('div', { class: 'tp-panel__body tl-day' }, d.items.map((b) => timelineEntry(b, ctx, { names }))))),
          ])
        : [frame('', emptyState('Nothing has happened yet', 'Changes you make to the universe appear here.'))]),
    );
  }

  await render();
  return { update: render, relabel: render };
}
