// Player screen: a read-only bridge-console view for players. The GM pushes what
// it shows (an entity dossier, a roster, a handout image, a message); every
// request uses view=player, so the server strips GM-only entities, fields and links.
//
// Layout is chosen per window: /u/:uid/screen (station) or /u/:uid/screen/full.
//   station  title bar + ambient side rails; pushes fill the central viewport
//   full     pushes take over the whole screen; idle shows the ambient dashboard

import { el, tierBadge, visibilityBadge } from '../ui.js';
import { formatClockTime, formatGameDate, formatGameTime } from '../time.js';
import { renderArticle } from '../article.js';
import { mapViewer } from '../map-viewer.js';
import { initiativeBar } from '../initiative-bar.js';
import { attackScene } from '../attack-scene.js';

const P = { view: 'player' };
const SHORT_FIELDS = new Set(['text', 'number', 'enum', 'tier', 'meter', 'bool', 'gametime', 'ref']);
const SKIP_KEYS = new Set(['rumor', 'summary', 'image', 'parent', 'tags']);

export async function mount(root, ctx) {
  const layout = ctx.params.layout === 'full' ? 'full' : 'station';
  let display = await ctx.api.display();
  let names = new Map(); // player-visible entities only
  const seen = new Set();
  let first = true;
  let shownPush = null; // pushedAt of the view on screen; the entry animation plays only for new pushes
  // Which floor/image each viewer shows, kept across live re-renders and reset by a new push.
  const floors = new Map();
  let activeViewer = null; // the viewer the arrow keys step through

  const onKey = (e) => {
    if (!activeViewer || e.target.closest?.('input, textarea, select')) return;
    const by = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1 }[e.key];
    if (by) (e.preventDefault(), activeViewer.step(by));
  };
  document.addEventListener('keydown', onKey);

  /** A step-through viewer for revealed maps that remembers its position. */
  function viewerFor(entity, field, maps, options = {}) {
    const key = `${entity.id}:${field.key}`;
    const viewer = mapViewer({
      maps,
      url: ctx.api.imageUrl,
      index: floors.get(key) ?? 0,
      onChange: (i) => floors.set(key, i),
      ...options,
    });
    activeViewer = viewer;
    return viewer;
  }

  // The turn bar sits above the screen and the attack scene over its body; both
  // outlive the screen's re-renders, so their animations carry on through them.
  const bar = initiativeBar(ctx);
  const scene = attackScene(ctx);
  const screen = el('div', { class: `scr scr--${layout}` });
  root.append(el('div', { class: 'scr-host' }, bar.node, el('div', { class: 'scr-stage' }, screen, scene.node)));
  const refreshBar = async () => {
    const combat = await ctx.api.encounter(P).catch(() => null);
    bar.update(combat);
    if (combat?.active) scene.show(combat.attack);
    else scene.clear();
  };

  // --- shared pieces --------------------------------------------------------------

  const cal = () => ctx.meta.calendar;
  // Pushed images load at once; rail thumbnails can wait.
  const img = (id, cls, alt = '', lazy = false) => el('img', { class: cls, src: ctx.api.imageUrl(id), alt, loading: lazy ? 'lazy' : 'eager' });

  /** Image, or a sigil with initials when there is none (or it's only rumoured). */
  function picture(entity, cls, lazy = false) {
    if (entity.data?.image) return img(entity.data.image, cls, entity.name, lazy);
    const initials = entity.name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase();
    return el('div', { class: `${cls} scr__sigil`, 'aria-hidden': 'true' }, entity.visibility === 'rumored' ? '?' : initials || '·');
  }

  function panel(title, ...body) {
    return el('section', { class: 'scr__panel' }, el('h2', { class: 'scr__panel-title' }, title), el('div', { class: 'scr__panel-body' }, ...body));
  }

  function isNew(id) {
    const fresh = !first && !seen.has(id);
    seen.add(id);
    return fresh ? 'is-new' : '';
  }

  const nameOf = (id) => names.get(id)?.name ?? null;

  function crumbs(entity) {
    const chain = [];
    let cursor = entity.data?.parent ? names.get(entity.data.parent) : null;
    while (cursor && chain.length < 12) {
      chain.unshift(cursor.name);
      cursor = cursor.data?.parent ? names.get(cursor.data.parent) : null;
    }
    return chain.length ? el('p', { class: 'scr__crumbs' }, chain.join('  ›  ')) : null;
  }

  function statValue(field, value) {
    switch (field.type) {
      case 'tier':
        return tierBadge(value);
      case 'meter':
        return el('span', { class: 'app-row' }, el('span', { class: 'tp-meter', style: `--value:${value};flex:1` }), `${Math.round(value * 100)}%`);
      case 'bool':
        return value ? 'Yes' : 'No';
      case 'gametime':
        return formatGameTime(value, cal());
      case 'ref':
        return nameOf(value);
      case 'number':
        return Number(value).toLocaleString();
      case 'enum':
        return String(value).toUpperCase();
      default:
        return String(value);
    }
  }

  // --- pushed views ----------------------------------------------------------------

  async function dossier(id) {
    let entity;
    try {
      entity = await ctx.api.get(id, P);
    } catch {
      return null; // hidden or removed since it was pushed
    }
    const type = ctx.type(entity.type);
    const rumored = entity.visibility === 'rumored';
    // The server only sends revealed gallery images (maps) to players.
    const galleries = rumored ? [] : type.fields.filter((f) => f.type === 'gallery' && entity.data[f.key]?.length);

    if (entity.type === 'article' && !rumored) {
      // Scene images / maps sit beside the text, one at a time.
      const field = galleries[0];
      const aside = field
        ? viewerFor(entity, field, entity.data[field.key], {
            labels: { prev: '◀', next: '▶', prevTitle: 'Previous image', nextTitle: 'Next image', fallback: (i) => `Image ${i + 1}` },
          }).node
        : null;
      return {
        kind: 'article',
        title: entity.data.outlet ? `${entity.data.outlet} // ${entity.name}` : entity.name,
        node: renderArticle({
          headline: entity.name, outlet: entity.data.outlet, byline: entity.data.byline, layout: entity.data.layout,
          body: entity.data.body, imageUrl: entity.data.image ? ctx.api.imageUrl(entity.data.image) : null,
          dateLabel: formatGameDate(entity.createdAt, cal()),
          aside,
        }),
      };
    }
    const relations = rumored ? [] : await ctx.api.relations(entity.id, P).catch(() => []);
    const stats = rumored
      ? []
      : type.fields.filter((f) => SHORT_FIELDS.has(f.type) && !SKIP_KEYS.has(f.key) && entity.data[f.key] != null && statValue(f, entity.data[f.key]) != null);
    const lists = rumored ? [] : type.fields.filter((f) => f.type === 'refs' && entity.data[f.key]?.length);
    const texts = rumored ? [] : type.fields.filter((f) => f.type === 'longtext' && !SKIP_KEYS.has(f.key) && entity.data[f.key]);

    // Below everything: Gigs step through floors one map at a time; other
    // levels (Places…) lay all their revealed maps out together.
    const mapSections = galleries.map((f) =>
      el('section', { class: 'scr-dossier__block scr-dossier__maps' },
        el('h3', { class: 'tp-label' }, ctx.fieldLabel(f)),
        entity.type === 'session'
          ? viewerFor(entity, f, entity.data[f.key], { buttonClass: 'tp-frame tp-btn tp-btn--interactive' }).node
          : el('div', { class: 'scr-maps' },
              entity.data[f.key].map((m) => el('figure', {}, img(m.image, '', m.label ?? ''), m.label ? el('figcaption', { class: 'tp-label' }, m.label) : null)))));

    return {
      title: `${ctx.typeLabel(type)} // ${entity.name}`,
      node: el(
        'article',
        { class: `scr-dossier ${rumored ? 'is-rumored' : ''}` },
        el('div', { class: 'scr-dossier__media' }, picture(entity, 'scr-dossier__image'),
          rumored ? el('p', { class: 'scr-dossier__stamp' }, 'Unconfirmed') : null),
        el('div', { class: 'scr-dossier__info' },
          el('p', { class: 'tp-deco' }, ctx.typeLabel(type), ' ', visibilityBadge(entity.visibility)),
          el('h1', { class: 'tp-display tp-glitch scr-dossier__name', 'data-text': entity.name }, entity.name),
          crumbs(entity),
          rumored
            ? el('blockquote', { class: 'scr-dossier__rumor' }, entity.data.rumor ?? 'Only whispers so far.')
            : entity.data.summary ? el('p', { class: 'scr-dossier__summary' }, entity.data.summary) : null,
          stats.length
            ? el('dl', { class: 'scr-stats' }, stats.map((f) => el('div', {}, el('dt', { class: 'tp-label' }, ctx.fieldLabel(f)), el('dd', {}, statValue(f, entity.data[f.key])))))
            : null,
          entity.data.tags?.length ? el('p', { class: 'app-row' }, entity.data.tags.map((t) => el('span', { class: 'tp-badge' }, t))) : null,
          lists.map((f) => el('div', { class: 'scr-dossier__block' }, el('h3', { class: 'tp-label' }, ctx.fieldLabel(f)), el('p', {}, entity.data[f.key].map(nameOf).filter(Boolean).join(', ')))),
          texts.map((f) => el('div', { class: 'scr-dossier__block' }, el('h3', { class: 'tp-label' }, ctx.fieldLabel(f)), el('p', {}, entity.data[f.key]))),
          relations.length
            ? el('div', { class: 'scr-dossier__block' },
                el('h3', { class: 'tp-label' }, ctx.typeLabel('relation', true)),
                el('ul', { class: 'scr-rels' }, relations.map((r) => {
                  const out = r.data.from === entity.id;
                  const v = r.data.value;
                  return el('li', {},
                    el('span', { class: 'tp-label' }, out ? r.data.kind : `← ${r.data.kind}`),
                    el('span', {}, out ? r.toName : r.fromName),
                    v != null && v >= 0 && v <= 1 ? el('span', { class: 'tp-meter', style: `--value:${v}` }) : el('span'),
                    el('span', { class: 'tp-mono' }, v == null ? '' : v >= 0 && v <= 1 ? `${Math.round(v * 100)}%` : v));
                })))
            : null,
        ),
        mapSections,
      ),
    };
  }

  async function roster(typeId) {
    const type = ctx.type(typeId);
    if (!type) return null;
    const list = await ctx.api.list({ ...P, type: typeId });
    return {
      title: ctx.typeLabel(type, true),
      node: el('div', { class: 'scr-roster' },
        list.length
          ? list.map((e) =>
              el('article', { class: 'scr-roster__card' },
                picture(e, 'scr-roster__image'),
                el('div', {},
                  el('h2', { class: 'scr-roster__name' }, e.name),
                  el('p', { class: 'app-row' }, tierBadge(e.data.tier), visibilityBadge(e.visibility)),
                  el('p', { class: 'tp-muted' }, e.visibility === 'rumored' ? e.data.rumor ?? '' : e.data.role ?? e.data.kind ?? '')),
              ))
          : el('p', { class: 'tp-muted' }, 'Nothing known yet.')),
    };
  }

  function handout(d) {
    return {
      title: d.caption ?? 'Handout',
      node: el('figure', { class: 'scr-handout' }, img(d.asset, 'scr-handout__image', d.caption ?? ''), d.caption ? el('figcaption', { class: 'tp-h3' }, d.caption) : null),
    };
  }

  function message(d) {
    return {
      title: d.title ?? 'Transmission',
      node: el('div', { class: `scr-message scr-message--${d.tone}` },
        d.title ? el('p', { class: 'tp-label scr-message__title' }, d.title) : null,
        el('p', { class: 'scr-message__text' }, d.text)),
    };
  }

  async function pushed() {
    switch (display.mode) {
      case 'entity':
        return dossier(display.id);
      case 'roster':
        return roster(display.type);
      case 'handout':
        return handout(display);
      case 'message':
        return message(display);
      default:
        return null;
    }
  }

  // --- ambient ---------------------------------------------------------------------

  async function ambientData() {
    const [events, communities, groups, people] = await Promise.all([
      ctx.api.list({ ...P, type: 'event', sort: 'created', limit: 8 }),
      ctx.api.list({ ...P, type: 'community' }),
      ctx.api.list({ ...P, type: 'group' }),
      ctx.api.list({ ...P, type: 'individual', sort: 'recent', limit: 10 }),
    ]);
    const control = await Promise.all(communities.map((c) => ctx.api.relations(c.id, { ...P, kind: 'controls' })));
    return { events, communities, groups, people, control };
  }

  const incidentLog = (events) =>
    events.length
      ? el('ul', { class: 'tp-log' }, events.map((e) =>
          el('li', { class: isNew(e.id) },
            el('time', { title: formatGameDate(e.createdAt, cal()) }, e.createdAt < ctx.meta.clock - 1440 ? formatGameDate(e.createdAt, cal()) : formatClockTime(e.createdAt)),
            el('span', {}, e.name, ' ', (e.data.severity ?? 0) >= 4 ? el('span', { class: 'tp-badge tp-badge--warning' }, 'Escalating') : null))))
      : el('p', { class: 'tp-muted' }, 'Quiet… for now.');

  const contactList = (people) =>
    el('ul', { class: 'scr-contacts' }, people.map((n) =>
      el('li', { class: isNew(n.id) }, picture(n, 'scr-contacts__image', true),
        el('div', {}, el('strong', {}, n.name), el('span', { class: 'tp-muted' }, n.visibility === 'rumored' ? 'Rumoured' : [n.data.role, n.data.status && n.data.status !== 'alive' ? n.data.status.toUpperCase() : null].filter(Boolean).join(' · '))))));

  const territory = (communities, control) =>
    communities.map((c, i) =>
      el('div', { class: 'pd__card' },
        el('div', { class: 'app-row' }, el('strong', {}, c.name), visibilityBadge(c.visibility), c.data.threat ? el('span', { class: 'tp-badge tp-badge--danger' }, `${ctx.engine.t('threat', 'Threat')} ${c.data.threat}/5`) : null),
        c.data.summary || c.data.rumor ? el('p', {}, c.data.summary ?? c.data.rumor) : null,
        control[i].map((r) =>
          el('div', { class: 'app-row', style: 'margin-top:.35rem' },
            el('span', { style: 'width:9rem' }, r.fromName),
            el('span', { class: 'tp-meter', style: `--value:${r.data.value ?? 0};flex:1` }),
            el('span', { class: 'tp-mono' }, `${Math.round((r.data.value ?? 0) * 100)}%`)))));

  const groupList = (groups) =>
    groups.map((g) => el('div', { class: 'pd__card' }, el('div', { class: 'app-row' }, el('strong', {}, g.name), tierBadge(g.data.tier), visibilityBadge(g.visibility)), g.data.kind ? el('p', {}, g.data.kind) : null));

  // --- layouts ---------------------------------------------------------------------

  function titleBar(title) {
    const other = layout === 'full' ? `${ctx.base}/screen` : `${ctx.base}/screen/full`;
    return el('header', { class: 'scr__bar' },
      el('span', { class: 'scr__bar-side' }, ctx.meta.era?.name ?? ctx.meta.name),
      el('h1', { class: 'scr__bar-title' }, title),
      el('span', { class: 'scr__bar-side scr__bar-side--end' },
        el('span', { class: 'tp-mono' }, `${formatGameDate(ctx.meta.clock, cal())}  ${formatClockTime(ctx.meta.clock)}`),
        el('a', { class: 'scr__layout', href: ctx.href(other), title: layout === 'full' ? 'Switch to station layout' : 'Switch to full-screen layout' }, layout === 'full' ? 'STN' : 'FULL')));
  }

  async function render() {
    names = new Map((await ctx.api.list({ ...P, limit: 100000 })).map((e) => [e.id, e]));
    if (display.pushedAt !== shownPush) floors.clear(); // a fresh push starts on the first floor
    activeViewer = null;
    const [view, amb] = await Promise.all([pushed(), ambientData()]);
    const isNewPush = Boolean(view) && display.pushedAt !== shownPush;
    const entering = isNewPush ? 'is-entering' : '';
    shownPush = display.pushedAt;
    // Themes animate pushes by kind (e.g. screamsheets print, everything else glitches in).
    const viewAttrs = { 'data-push-kind': view ? view.kind ?? display.mode : null };

    if (layout === 'station') {
      screen.replaceChildren(
        titleBar(view?.title ?? 'Main Viewer'),
        el('div', { class: 'scr__body' },
          el('aside', { class: 'scr__rail' },
            panel('Status',
              el('p', { class: 'scr__clock tp-mono' }, formatClockTime(ctx.meta.clock)),
              el('p', { class: 'tp-label' }, formatGameDate(ctx.meta.clock, cal())),
              ctx.meta.era ? el('p', { class: 'tp-muted' }, ctx.meta.era.name) : null),
            panel(ctx.typeLabel('event', true), incidentLog(amb.events))),
          el('main', { class: `scr__view ${entering}`, ...viewAttrs },
            view?.node ?? el('div', { class: 'scr-ambient' },
              el('p', { class: 'tp-deco' }, ctx.meta.system ?? ''),
              el('h1', { class: 'tp-display tp-glitch', 'data-text': ctx.meta.name }, ctx.meta.name),
              el('div', { class: 'scr-ambient__grid' }, territory(amb.communities, amb.control)))),
          el('aside', { class: 'scr__rail' },
            panel(ctx.typeLabel('individual', true), contactList(amb.people)),
            amb.groups.length ? panel(ctx.typeLabel('group', true), groupList(amb.groups)) : null)),
      );
    } else if (view) {
      screen.replaceChildren(titleBar(view.title), el('main', { class: `scr__view scr__view--full ${entering}`, ...viewAttrs }, view.node));
    } else {
      screen.replaceChildren(
        titleBar(ctx.meta.name),
        el('div', { class: 'pd__cols scr__dashboard' },
          panel(ctx.typeLabel('event', true), incidentLog(amb.events)),
          panel(ctx.typeLabel('community', true), territory(amb.communities, amb.control), groupList(amb.groups)),
          panel(ctx.typeLabel('individual', true), contactList(amb.people))),
      );
    }
    ctx.engine.applyLexicon(screen);
    // Leave the entry state when the pushed view's own animation ends; ignore the
    // theme's decorations (::before/::after) and animations nested deeper inside.
    const viewEl = screen.querySelector('.scr__view.is-entering');
    viewEl?.addEventListener('animationend', function done(e) {
      if (e.target.parentElement !== viewEl || e.pseudoElement) return;
      viewEl.classList.remove('is-entering');
      viewEl.removeEventListener('animationend', done);
    });
    if (isNewPush) {
      viewEl.scrollTop = 0;
      // How far the pushed view reaches down the viewport, for effects that travel with it.
      const pushed = viewEl.firstElementChild;
      const depth = Math.min(pushed.offsetTop + pushed.offsetHeight, viewEl.clientHeight) - 24;
      viewEl.style.setProperty('--push-depth', `${Math.max(depth, 0)}px`);
    }
    first = false;
    document.title = `${view?.title ?? ctx.meta.name} · Player Screen`;
  }

  await Promise.all([render(), refreshBar()]);
  return {
    update: render,
    relabel: render,
    encounter: refreshBar,
    async display(next) {
      display = next;
      await render();
    },
    unmount: () => document.removeEventListener('keydown', onKey),
  };
}
