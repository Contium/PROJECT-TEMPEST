// Sessions: the game nights and the handouts given out at them.
//
//   #/sessions/log             every session, newest first; + New session
//   #/sessions/log/<id>        one session: number, title, date, Planned/Played; the prep checklist;
//                              what it features (people, places, things: open or push in one click);
//                              its handouts; GM notes; the players' recap (share it, push it)
//   #/sessions/handouts        every handout; + New handout
//   #/sessions/handouts/<id>   one handout: its words, picture and look, beside a preview of what
//                              the players get; push it, put it in their Codex, obscure its text
//
// Pages save themselves as you type (a moment after you stop), like notes.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { sessions as sessionsApi, handouts as handoutsApi, allEntities, imageUrl, uploadImage } from '../api.js';
import { push, pushButton } from '../push/push.js';
import { hrefOf } from '../forge/entity-model.js';
import { KINDS } from '../forge/preset-model.js';
import { openImage } from '../image-viewer.js';
import { STATUSES, STYLES, OBSCURE_STYLES, byNumber, sessionTitle, dayOf, newBeatId, playerHandout, paragraphs } from './session-model.js';
import { renderHandout } from './handout-render.js';

const LOG = '#/sessions/log';
const HANDOUTS = '#/sessions/handouts';
const STYLE_GLYPH = { letter: '✉', note: '✎', document: '▤', datapad: '▣', picture: '▨' };
const initials = (name) => String(name ?? '?').split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.replace(/\W/g, '')[0]).join('').toUpperCase() || '?';
const styleOf = (id) => STYLES.find((s) => s.id === id) ?? STYLES[0];

export async function mount(root, { tab, item }) {
  const handouts = tab?.id === 'handouts';
  if (handouts) return item ? handoutPage(root, item) : handoutList(root);
  return item ? sessionPage(root, item) : sessionList(root);
}

/** Saves a moment after the last change, and at once when asked (before a push, or leaving). */
function autosaver(save) {
  const status = el('span', { class: 'fd-status', role: 'status' }, 'Saved');
  let timer = 0;
  let pending = null;
  let running = Promise.resolve();
  const show = (label, dirty) => ((status.textContent = label), status.classList.toggle('is-dirty', dirty));
  async function flush() {
    clearTimeout(timer);
    await running;
    if (!pending) return;
    const value = pending;
    pending = null;
    show('Saving…', true);
    running = save(value).then(
      () => !pending && show('Saved', false),
      (err) => (toastError(err), show('Not saved: check and try again', true)),
    );
    await running;
  }
  return {
    status,
    queue(value) {
      pending = value;
      show('Unsaved changes', true);
      clearTimeout(timer);
      timer = setTimeout(flush, 700);
    },
    flush,
  };
}

const placeholder = (title, text, action) =>
  el('article', { class: 'tp-frame tp-panel app-placeholder' },
    el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-h3' }, title), el('p', { class: 'tp-muted' }, text), action));

const panel = (title, hint, ...body) =>
  el('section', { class: 'tp-frame tp-panel ses-panel' },
    el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, title), hint ? el('span', { class: 'tp-dim ses-panel__hint' }, hint) : null),
    el('div', { class: 'tp-panel__body' }, ...body));

// --- the session log ---------------------------------------------------------------------------

async function sessionList(root) {
  const [list, hands] = await Promise.all([sessionsApi.list(), handoutsApi.list().catch(() => [])]);
  const all = byNumber(list);
  const create = async (button) => {
    button.disabled = true;
    try {
      const made = await sessionsApi.create({ number: (all[0]?.number ?? 0) + 1, status: 'planned' });
      location.hash = `${LOG}/${made.id}`;
    } catch (err) {
      toastError(err);
      button.disabled = false;
    }
  };
  const newButton = () => el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', onClick: (e) => create(e.currentTarget) }, '+ New session');
  const card = (s) => {
    const done = s.plan.filter((b) => b.done).length;
    const n = hands.filter((h) => h.session === s.id).length;
    return el('li', {},
      el('a', { class: `tp-frame tp-panel ses-card ${s.status === 'planned' ? 'is-planned' : ''}`, href: `${LOG}/${s.id}` },
        el('span', { class: 'ses-card__num tp-display', 'aria-hidden': 'true' }, s.number),
        el('span', { class: 'ses-card__text' },
          el('span', { class: 'tp-label' }, [`Session ${s.number}`, dayOf(s.date)].filter(Boolean).join(' · ')),
          el('span', { class: 'ses-card__title' }, s.title || 'Untitled'),
          el('span', { class: 'app-row ses-card__meta' },
            el('span', { class: `tp-badge ${s.status === 'planned' ? 'tp-badge--interactive' : ''}` }, STATUSES.find((x) => x.id === s.status).label),
            s.plan.length ? el('span', { class: 'tp-dim tp-mono' }, `Plan ${done}/${s.plan.length}`) : null,
            n ? el('span', { class: 'tp-dim' }, `${n} handout${n === 1 ? '' : 's'}`) : null,
            s.recapShared && s.recap ? el('span', { class: 'tp-dim', title: 'The recap is in the players\' Codex' }, '◉ Recap shared') : null),
          s.recap ? el('span', { class: 'ses-card__summary' }, paragraphs(s.recap)[0]) : null)));
  };
  root.replaceChildren(
    el('div', { class: 'cv' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${all.length} session${all.length === 1 ? '' : 's'}`),
        el('span', { class: 'app-actions' }, newButton())),
      all.length
        ? el('ul', { class: 'ses-list' }, all.map(card))
        : placeholder('No sessions yet', 'Plan your next game night: a checklist of scenes, the people and places it features, its handouts, your notes, and a recap for the players afterwards.', newButton())));
  return {};
}

async function sessionPage(root, id) {
  let s;
  try {
    s = await sessionsApi.get(id);
  } catch (err) {
    root.replaceChildren(placeholder('No such session', err.message, el('a', { class: 'tp-frame tp-btn tp-btn--sm', href: LOG }, '← Session log')));
    return {};
  }
  const [everyone, hands] = await Promise.all([allEntities().catch(() => []), handoutsApi.list().catch(() => [])]);
  const saver = autosaver((v) => sessionsApi.save(v));
  const changed = () => saver.queue(structuredClone(s));
  const page = el('div', { class: 'ses' });
  root.replaceChildren(page);

  // --- head: number, title, date, status --------------------------------------------------
  function head() {
    const seg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Status' },
      STATUSES.map((x) => el('button', {
        type: 'button', class: `fd-seg__btn ${s.status === x.id ? 'is-on' : ''}`, 'aria-pressed': String(s.status === x.id),
        onClick: () => ((s.status = x.id), changed(), render()),
      }, x.label)));
    return el('section', { class: 'tp-frame tp-panel ses-head' },
      el('div', { class: 'tp-panel__body ses-head__body' },
        el('a', { class: 'app-link ses-back', href: LOG }, '← Session log'),
        el('div', { class: 'ses-head__row' },
          el('label', { class: 'tp-field ses-head__num' }, el('span', { class: 'tp-label' }, 'Session'),
            el('input', { class: 'tp-input tp-mono', type: 'number', min: 1, max: 9999, value: s.number, onChange: (e) => ((s.number = Math.max(1, Math.round(Number(e.target.value)) || 1)), changed()) })),
          el('label', { class: 'tp-field ses-head__title' }, el('span', { class: 'tp-label' }, 'Title'),
            el('input', { class: 'tp-input', value: s.title, maxlength: 120, placeholder: 'e.g. The Halcyon Extraction', onInput: (e) => ((s.title = e.target.value), changed(), (document.title = `TEMPEST · ${sessionTitle(s)}`)) })),
          el('label', { class: 'tp-field ses-head__date' }, el('span', { class: 'tp-label' }, 'Played on'),
            el('input', { class: 'tp-input', type: 'date', value: s.date ?? '', onChange: (e) => ((s.date = e.target.value || null), changed()) })),
          el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Status'), seg)),
        el('div', { class: 'app-row ses-head__foot' },
          saver.status,
          el('button', {
            type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost',
            onClick: async () => {
              if (!(await confirmDialog({ title: `Delete ${sessionTitle(s)}?`, body: 'Its plan, notes and recap go with it. Its handouts stay, under Handouts.', confirmLabel: 'Delete', danger: true }))) return;
              try {
                await sessionsApi.remove(s.id);
                toast(`Deleted ${sessionTitle(s)}`);
                location.hash = LOG;
              } catch (err) {
                toastError(err);
              }
            },
          }, 'Delete'))));
  }

  // --- plan: the prep checklist ---------------------------------------------------------------
  function plan() {
    const done = s.plan.filter((b) => b.done).length;
    const add = el('input', { class: 'tp-input', placeholder: 'Add a scene, beat or reminder, then Enter', maxlength: 300, 'aria-label': 'Add to the plan' });
    const addNow = () => {
      const text = add.value.trim();
      if (!text) return;
      s.plan.push({ id: newBeatId(), text, done: false });
      changed();
      render();
      page.querySelector('.ses-plan__add input')?.focus();
    };
    add.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), addNow()));
    const move = (i, by) => {
      [s.plan[i], s.plan[i + by]] = [s.plan[i + by], s.plan[i]];
      changed();
      render();
    };
    return panel('Plan', s.plan.length ? `${done} of ${s.plan.length} done` : 'Scenes, beats, things to prepare',
      s.plan.length
        ? el('ol', { class: 'ses-plan' }, s.plan.map((b, i) =>
            el('li', { class: `ses-plan__row ${b.done ? 'is-done' : ''}` },
              el('input', { type: 'checkbox', checked: b.done, 'aria-label': `Done: ${b.text}`, onChange: (e) => ((b.done = e.target.checked), changed(), render()) }),
              el('input', { class: 'tp-input ses-plan__text', value: b.text, maxlength: 300, 'aria-label': `Plan line ${i + 1}`, onInput: (e) => ((b.text = e.target.value), changed()) }),
              el('span', { class: 'ses-plan__tools' },
                el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move up', disabled: i === 0, onClick: () => move(i, -1) }, '▲'),
                el('button', { type: 'button', class: 'fd-icon-btn', 'aria-label': 'Move down', disabled: i === s.plan.length - 1, onClick: () => move(i, 1) }, '▼'),
                el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Remove ${b.text}`, onClick: () => (s.plan.splice(i, 1), changed(), render()) }, '×')))))
        : null,
      el('div', { class: 'ses-plan__add app-row' }, add, el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: addNow }, '+ Add')));
  }

  // --- featured: people, places and things, one click away ------------------------------------------
  function featured() {
    const known = new Map(everyone.map((e) => [e.id, e]));
    const options = Object.entries(KINDS).filter(([k]) => k !== 'netcards').map(([kind, k]) => {
      const list = everyone.filter((e) => e.kind === kind && !s.cast.includes(e.id));
      return list.length ? el('optgroup', { label: k.label }, list.map((e) => el('option', { value: e.id }, e.name))) : null;
    });
    const pick = el('select', {
      class: 'tp-select', 'aria-label': 'Feature an entry',
      onChange: (e) => {
        if (!e.target.value) return;
        s.cast.push(e.target.value);
        changed();
        render();
      },
    }, el('option', { value: '' }, everyone.length ? 'Feature someone or something…' : 'Nothing made yet'), options);
    return panel('Featuring', 'Open or push them in one click',
      s.cast.length
        ? el('ul', { class: 'ses-cast' }, s.cast.map((cid, i) => {
            const e = known.get(cid);
            return el('li', { class: 'ses-cast__row' },
              e?.image ? el('img', { class: 'ses-cast__face', src: imageUrl(e.image), alt: '' }) : el('span', { class: 'ses-cast__face ses-cast__sigil', 'aria-hidden': 'true' }, initials(e?.name)),
              el('span', { class: 'ses-cast__text' },
                e ? el('a', { class: 'app-link ses-cast__name', href: hrefOf(e) }, e.name) : el('span', { class: 'tp-dim' }, 'Deleted'),
                el('span', { class: 'tp-dim ses-cast__kind' }, e ? (KINDS[e.kind]?.categories.find((c) => c.id === e.category)?.label ?? KINDS[e.kind]?.entity ?? '') : '')),
              e ? pushButton('Push', () => push({ mode: 'entity', id: e.id }), { title: `Show ${e.name} on the player screen (as their sheet allows)` }) : null,
              el('button', { type: 'button', class: 'fd-icon-btn fd-icon-btn--danger', 'aria-label': `Stop featuring ${e?.name ?? 'this'}`, onClick: () => (s.cast.splice(i, 1), changed(), render()) }, '×'));
          }))
        : el('p', { class: 'tp-muted' }, 'The NPCs, places, items and stories this session is about.'),
      pick);
  }

  // --- handouts ------------------------------------------------------------------------------
  function handoutsPanel() {
    const mine = hands.filter((h) => h.session === s.id);
    const others = hands.filter((h) => h.session !== s.id);
    const attach = el('select', {
      class: 'tp-select', 'aria-label': 'Add an existing handout',
      onChange: async (e) => {
        const h = hands.find((x) => x.id === e.target.value);
        if (!h) return;
        try {
          Object.assign(h, await handoutsApi.save({ ...h, session: s.id }));
          render();
        } catch (err) {
          toastError(err);
        }
      },
    }, el('option', { value: '' }, 'Add an existing handout…'), others.map((h) => el('option', { value: h.id }, h.title)));
    return panel('Handouts', 'Letters, notes, documents and pictures to give out',
      mine.length
        ? el('ul', { class: 'ses-hands' }, mine.map((h) =>
            el('li', { class: 'ses-hands__row' },
              el('span', { class: 'ses-hands__glyph', 'aria-hidden': 'true' }, STYLE_GLYPH[h.style]),
              el('span', { class: 'ses-cast__text' },
                el('a', { class: 'app-link', href: `${HANDOUTS}/${h.id}` }, h.title),
                el('span', { class: 'tp-dim' }, [styleOf(h.style).label, h.obscure ? OBSCURE_STYLES.find((o) => o.id === h.obscure).label : null, h.revealed ? '◉ In the Codex' : null].filter(Boolean).join(' · '))),
              pushButton('Push', async () => {
                const shown = await push({ mode: 'handout', id: h.id });
                if (shown) (h.revealed = true), render();
              }, { title: 'Hand it to the players: on the player screen, and into their Codex' }))))
        : el('p', { class: 'tp-muted' }, 'None yet.'),
      el('div', { class: 'app-row' },
        el('button', {
          type: 'button', class: 'tp-frame tp-btn tp-btn--sm',
          onClick: async () => {
            try {
              const made = await handoutsApi.create({ title: 'New handout', style: 'letter', session: s.id });
              await saver.flush();
              location.hash = `${HANDOUTS}/${made.id}`;
            } catch (err) {
              toastError(err);
            }
          },
        }, '+ New handout'),
        others.length ? attach : null));
  }

  // --- notes and recap -------------------------------------------------------------------------
  function notes() {
    return panel('GM notes', 'Only you see these',
      el('textarea', { class: 'tp-textarea ses-notes', rows: 10, maxlength: 20000, placeholder: 'What happened, who owes whom, loose threads for next time…', 'aria-label': 'GM notes', onInput: (e) => ((s.notes = e.target.value), changed()) }, s.notes));
  }
  function recap() {
    const pushRecap = pushButton('Push recap', async () => {
      await saver.flush();
      const shown = await push({ mode: 'recap', id: s.id });
      if (shown) (s.recapShared = true), render();
    }, { title: '"Previously…" on the player screen; it joins their Codex too' });
    pushRecap.disabled = !s.recap.trim();
    return panel('Recap for the players', '"Previously…"',
      el('textarea', {
        class: 'tp-textarea', rows: 6, maxlength: 8000, placeholder: 'What the players remember of this session, in a few lines.', 'aria-label': 'Recap for the players',
        onInput: (e) => ((s.recap = e.target.value), changed(), (pushRecap.disabled = !s.recap.trim())),
      }, s.recap),
      el('div', { class: 'app-row ses-recap__foot' },
        el('label', { class: 'app-row', title: 'Players can read the recap in their Codex, under Sessions' },
          el('input', { type: 'checkbox', checked: s.recapShared, onChange: (e) => ((s.recapShared = e.target.checked), changed()) }),
          el('span', {}, 'In the players\' Codex')),
        pushRecap));
  }

  function render() {
    page.replaceChildren(
      head(),
      el('div', { class: 'ses-cols' },
        el('div', { class: 'ses-col' }, plan(), notes()),
        el('div', { class: 'ses-col' }, featured(), handoutsPanel(), recap())));
  }
  render();
  document.title = `TEMPEST · ${sessionTitle(s)}`;
  return { unmount: () => saver.flush() };
}

// --- handouts -----------------------------------------------------------------------------------

async function handoutList(root) {
  const [list, sess] = await Promise.all([handoutsApi.list(), sessionsApi.list().catch(() => [])]);
  const all = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const create = async (button) => {
    button.disabled = true;
    try {
      const made = await handoutsApi.create({ title: 'New handout', style: 'letter' });
      location.hash = `${HANDOUTS}/${made.id}`;
    } catch (err) {
      toastError(err);
      button.disabled = false;
    }
  };
  const newButton = () => el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', onClick: (e) => create(e.currentTarget) }, '+ New handout');
  const sessionOf = (h) => sess.find((x) => x.id === h.session);
  root.replaceChildren(
    el('div', { class: 'cv' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${all.length} handout${all.length === 1 ? '' : 's'}`),
        el('span', { class: 'app-actions' }, newButton())),
      all.length
        ? el('ul', { class: 'cv-grid' }, all.map((h) =>
            el('li', {},
              el('a', { class: 'tp-frame tp-panel cv-card', href: `${HANDOUTS}/${h.id}` },
                h.revealed ? el('span', { class: 'cv-card__known', title: 'In the players\' Codex' }, '◉ Codex') : null,
                h.image ? el('img', { class: 'cv-card__image', src: imageUrl(h.image), alt: '', loading: 'lazy' }) : el('span', { class: `cv-card__image cv-card__sigil ho-sigil ho-sigil--${h.style}`, 'aria-hidden': 'true' }, STYLE_GLYPH[h.style]),
                el('span', { class: 'cv-card__text' },
                  el('span', { class: 'cv-card__name' }, h.title),
                  el('span', { class: 'tp-dim cv-card__meta' }, [styleOf(h.style).label, h.obscure ? OBSCURE_STYLES.find((o) => o.id === h.obscure).label : null].filter(Boolean).join(' · ')),
                  h.text && !h.obscure ? el('span', { class: 'cv-card__summary' }, paragraphs(h.text)[0]) : null,
                  sessionOf(h) ? el('span', { class: 'tp-dim cv-card__preset' }, sessionTitle(sessionOf(h))) : null)))))
        : placeholder('No handouts yet', 'Letters, scrawled notes, typed documents, datapad messages and pictures to hand the players. Push one and it joins their Codex.', newButton())));
  return {};
}

async function handoutPage(root, id) {
  let h;
  try {
    h = await handoutsApi.get(id);
  } catch (err) {
    root.replaceChildren(placeholder('No such handout', err.message, el('a', { class: 'tp-frame tp-btn tp-btn--sm', href: HANDOUTS }, '← Handouts')));
    return {};
  }
  const sess = byNumber(await sessionsApi.list().catch(() => []));
  const saver = autosaver((v) => handoutsApi.save(v));
  const preview = el('div', { class: 'ses-preview' });
  const drawPreview = () => preview.replaceChildren(renderHandout(playerHandout(h), { imageUrl, openImage: (items, i) => openImage(items.map((x) => ({ ...x, src: imageUrl(x.image) })), i) }));
  const changed = ({ redraw = false } = {}) => {
    saver.queue(structuredClone(h));
    drawPreview();
    if (redraw) render();
  };
  const field = (label, control, hint = null) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), control, hint ? el('span', { class: 'tp-dim ses-hint' }, hint) : null);
  const page = el('div', { class: 'ses' });
  root.replaceChildren(page);

  function picture() {
    const file = el('input', {
      type: 'file', accept: 'image/*', hidden: true,
      onChange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          h.image = (await uploadImage(f)).id;
          changed({ redraw: true });
        } catch (err) {
          toastError(err);
        }
      },
    });
    return el('div', { class: 'tp-field' },
      el('span', { class: 'tp-label' }, 'Picture'),
      el('div', { class: 'app-row' },
        h.image ? el('img', { class: 'ses-thumb', src: imageUrl(h.image), alt: '' }) : null,
        file,
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => file.click() }, h.image ? 'Replace' : 'Choose image'),
        h.image ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost', onClick: () => ((h.image = null), changed({ redraw: true })) }, 'Remove') : null),
      h.image ? el('input', { class: 'tp-input', value: h.caption, maxlength: 160, placeholder: 'Caption (optional)', 'aria-label': 'Caption', onInput: (e) => ((h.caption = e.target.value), changed()) }) : null);
  }

  function editor() {
    return el('section', { class: 'tp-frame tp-panel ses-panel' },
      el('header', { class: 'tp-panel__head' },
        el('a', { class: 'app-link', href: HANDOUTS }, '← Handouts'),
        saver.status),
      el('div', { class: 'tp-panel__body ses-form' },
        field('Title', el('input', { class: 'tp-input', value: h.title, maxlength: 120, onInput: (e) => ((h.title = e.target.value), changed(), (document.title = `TEMPEST · ${h.title}`)) }), 'Players see it too: it names the handout in their Codex.'),
        el('div', { class: 'tp-field' },
          el('span', { class: 'tp-label' }, 'Looks like'),
          el('div', { class: 'ses-styles', role: 'radiogroup', 'aria-label': 'Looks like' }, STYLES.map((x) =>
            el('button', {
              type: 'button', role: 'radio', 'aria-checked': String(h.style === x.id), class: `ses-style ${h.style === x.id ? 'is-on' : ''}`, title: x.hint,
              onClick: () => ((h.style = x.id), changed({ redraw: true })),
            }, el('span', { class: 'ses-style__glyph', 'aria-hidden': 'true' }, STYLE_GLYPH[x.id]), x.label)))),
        picture(),
        field('Text', el('textarea', { class: 'tp-textarea', rows: 9, maxlength: 8000, placeholder: 'The words on it. A blank line starts a new paragraph.', onInput: (e) => ((h.text = e.target.value), changed()) }, h.text)),
        field(h.style === 'datapad' ? 'From' : 'Signed', el('input', { class: 'tp-input', value: h.from, maxlength: 120, placeholder: h.style === 'datapad' ? 'e.g. UNKNOWN SENDER' : 'e.g. — W.', onInput: (e) => ((h.from = e.target.value), changed()) })),
        field('Players can read the text?', el('select', { class: 'tp-select', onChange: (e) => ((h.obscure = e.target.value || null), changed({ redraw: true })) },
          el('option', { value: '', selected: !h.obscure }, 'Yes, all of it'),
          OBSCURE_STYLES.map((o) => el('option', { value: o.id, selected: h.obscure === o.id }, `No: ${o.label.toLowerCase()}`))),
        'Obscured, they see that something is written, not what (the words never reach their screens). Switch back when they crack it.'),
        field('Session', el('select', { class: 'tp-select', onChange: (e) => ((h.session = e.target.value || null), changed()) },
          el('option', { value: '', selected: !h.session }, 'None'),
          sess.map((x) => el('option', { value: x.id, selected: h.session === x.id }, sessionTitle(x)))))));
  }

  function side() {
    return el('section', { class: 'tp-frame tp-panel ses-panel ses-side' },
      el('header', { class: 'tp-panel__head' },
        el('h2', { class: 'tp-panel__title' }, 'As the players see it'),
        el('span', { class: 'app-actions' },
          el('label', { class: 'app-row', title: 'Players can read it in their Codex, under Handouts' },
            el('input', { type: 'checkbox', checked: h.revealed, onChange: (e) => ((h.revealed = e.target.checked), changed()) }),
            el('span', {}, 'In the Codex')),
          pushButton('Push handout', async () => {
            await saver.flush();
            const shown = await push({ mode: 'handout', id: h.id });
            if (shown) (h.revealed = true), render();
          }, { title: 'Hand it to the players: on the player screen, and into their Codex' }))),
      el('div', { class: 'tp-panel__body' }, preview),
      el('footer', { class: 'tp-panel__foot app-actions' },
        el('button', {
          type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost',
          onClick: async () => {
            if (!(await confirmDialog({ title: `Delete "${h.title}"?`, body: 'It leaves the players\' Codex too.', confirmLabel: 'Delete', danger: true }))) return;
            try {
              await handoutsApi.remove(h.id);
              toast(`Deleted "${h.title}"`);
              location.hash = HANDOUTS;
            } catch (err) {
              toastError(err);
            }
          },
        }, 'Delete handout')));
  }

  function render() {
    page.replaceChildren(el('div', { class: 'ses-cols ses-cols--handout' }, editor(), side()));
    drawPreview();
  }
  render();
  document.title = `TEMPEST · ${h.title}`;
  return { unmount: () => saver.flush() };
}
