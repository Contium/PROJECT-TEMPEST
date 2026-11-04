// Universe overview: premise, eras, the Atlas (containment tree), counts, what's coming, what just happened.

import { el, frame, panelHead, emptyState, visibilityBadge } from '../ui.js';
import { formatGameDate } from '../time.js';
import { atlasRoots, atlasChildren } from '../model.js';
import { timelineEntry } from './timeline.js';

export async function mount(root, ctx) {
  const page = el('div', { class: 'app-page' });
  root.append(page);

  function atlasNode(entity, names, depth) {
    const kids = atlasChildren(entity.id, names);
    const label = el('span', { class: 'atlas__label' },
      el('a', { class: 'app-link', href: ctx.entityHref(entity) }, entity.name),
      el('span', { class: 'tp-deco' }, ctx.typeLabel(entity.type)),
      visibilityBadge(entity.visibility));
    if (!kids.length) return el('li', { class: 'atlas__leaf' }, label);
    return el('li', {}, el('details', { open: depth < 4 }, el('summary', {}, label), el('ul', { class: 'atlas' }, kids.map((k) => atlasNode(k, names, depth + 1)))));
  }

  async function render() {
    const [names, timeline, eras, session] = await Promise.all([
      ctx.names(),
      ctx.api.timeline({ limit: 60 }),
      ctx.eras(),
      ctx.meta.active_session ? ctx.api.get(ctx.meta.active_session).catch(() => null) : null,
    ]);
    const live = [...names.values()].filter((e) => !e.deleted);
    const count = (pred) => live.filter(pred).length;
    const cal = ctx.meta.calendar;

    const tiles = ctx.types.map((t) =>
      el(
        'a',
        { class: 'tp-frame app-tile', href: ctx.href(`${ctx.base}/e/${t.id}`) },
        el('div', { class: 'tp-stat' }, el('span', { class: 'tp-label' }, ctx.typeLabel(t, true)), el('span', { class: 'tp-stat__value' }, count((e) => e.type === t.id))),
      ),
    );

    const eraStrip = el(
      'ol',
      { class: 'eras' },
      eras.map((era) =>
        el(
          'li',
          { class: `eras__item ${era.id === ctx.meta.era?.id ? 'is-current' : ''}` },
          el('a', { class: 'app-link', href: ctx.entityHref(era) }, era.name),
          el('span', { class: 'tp-mono tp-dim' }, `${formatGameDate(era.data.start, cal)} → ${era.data.end != null ? formatGameDate(era.data.end, cal) : 'now'}`),
        ),
      ),
    );

    const roots = atlasRoots(names);
    const upcoming = timeline.filter((b) => b.scheduled && !b.undone).reverse();
    const recent = timeline.filter((b) => !b.scheduled).slice(0, 8);

    page.replaceChildren(
      el(
        'div',
        { class: 'app-page__head' },
        el('div', {},
          el('h1', { class: 'tp-h1' }, ctx.meta.name),
          el('span', { class: 'tp-deco' }, [ctx.meta.system, ctx.meta.era?.name, ctx.meta.clockLabel].filter(Boolean).join(' // '))),
        el('div', { class: 'app-row' },
          session ? el('span', { class: 'tp-badge tp-badge--interactive' }, `${ctx.typeLabel('session')} ${session.data.number ? `#${session.data.number}` : session.name} in progress`) : null,
          el('span', { class: 'tp-badge tp-badge--danger' }, `${count((e) => e.visibility === 'hidden')} GM only`),
          el('span', { class: 'tp-badge tp-badge--warning' }, `${count((e) => e.visibility === 'rumored')} rumoured`),
        ),
      ),
      ctx.meta.summary ? el('p', { class: 'tp-muted app-premise' }, ctx.meta.summary) : null,
      frame('',
        panelHead(ctx.engine.t('timeline', 'Time-Line'), el('a', { class: 'app-link tp-label', href: ctx.href(`${ctx.base}/timeline`) }, 'Open')),
        el('div', { class: 'tp-panel__body' },
          eras.length ? eraStrip : el('p', { class: 'tp-muted' }, 'No eras yet. Add one under Eras to name the spans of your history.'))),
      el(
        'div',
        { class: 'app-grid app-grid--wide' },
        frame('',
          panelHead('Atlas', el('span', { class: 'tp-deco' }, `${roots.length} ROOTS`)),
          el('div', { class: 'tp-panel__body' },
            roots.length
              ? el('ul', { class: 'atlas atlas--root' }, roots.map((r) => atlasNode(r, names, 0)))
              : el('p', { class: 'tp-muted' }, 'Places appear here as you nest them: System › World › Nation › Region › Community › Place.'))),
        el('div', { class: 'app-stack' },
          frame('',
            panelHead('Scheduled', el('span', { class: 'tp-deco' }, `${upcoming.length} PENDING`)),
            el('div', { class: 'tp-panel__body' },
              upcoming.length
                ? upcoming.map((b) => timelineEntry(b, ctx, { compact: true, names }))
                : el('p', { class: 'tp-muted' }, 'Nothing scheduled. Pick a future time when you save a change to plan it ahead.'))),
          frame('',
            panelHead('Recent', el('a', { class: 'app-link tp-label', href: ctx.href(`${ctx.base}/timeline`) }, 'Full Time-Line')),
            el('div', { class: 'tp-panel__body' },
              recent.length ? recent.map((b) => timelineEntry(b, ctx, { compact: true, names })) : emptyState('A blank universe', 'Start anywhere in the sidebar: a System, a Nation, or a single Individual.'))),
        ),
      ),
      el('div', { class: 'app-tiles' }, tiles),
    );
  }

  await render();
  return { update: render, relabel: render };
}
