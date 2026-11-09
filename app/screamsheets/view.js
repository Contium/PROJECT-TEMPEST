// World › Screamsheets: in-world news.
//   #/world/screamsheets          every screamsheet in the project, newest first
//   #/world/screamsheets/new      the Screamsheet Generator
//   #/world/screamsheets/<id>     one screamsheet: read it, push it, reveal it, edit it; on the GM view each part
//                                 (outlet, date line, headline, byline, article) can be obscured or hidden
//
// The generator follows the five steps of R. Talsorian's Screamsheet Generator
// (type, content, headline, fill-ins, polish), with a live preview. Its tables
// come from a pack built from the GM's own PDF (scripts/import_screamsheet.py).
// Blanks suggest names from the project: characters for people, Night City's
// districts and the project's points of interest for places.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { screamsheets as api, packs as packsApi, allEntities, pois as globePois, cityPois, imageUrl, uploadImage } from '../api.js';
import { push, revealAndPush, pushButton } from '../push/push.js';
import { renderIssue } from './article.js';
import { LAYOUTS, SECTIONS, PICTURE_SPOTS, PARTS as SHEET_PARTS, playerCopy, newItemId, parseLinks, parseNotes, linksText, notesText } from './screamsheet-model.js';
import { hrefOf as entryHref } from '../forge/entity-model.js';
import { visibilityControl } from '../forge/visibility-menu.js';
import { generate, compose, fieldsIn, fill, fieldKind, memberSuggestions, headlineOptions, partText, roll } from './generator.js';
import { UNIQUE_POI_MODES } from '../projects/settings-model.js';

const PARTS = [['intro', 'Intro'], ['body', 'Body'], ['conclusion', 'Conclusion']];
const TABLES = { intro: 'intros', body: 'bodies', conclusion: 'conclusions' };
const BASE = '#/world/screamsheets';
const pick = (list) => list[roll(list.length) - 1];
const snippet = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text).replace(/\s+/g, ' ');

export async function mount(root, { item, project }) {
  if (!item) return list(root);
  if (item === 'new') return generator(root, { project });
  let sheet;
  try {
    sheet = await api.get(item);
  } catch (err) {
    root.replaceChildren(el('article', { class: 'tp-frame tp-panel app-placeholder' },
      el('div', { class: 'tp-panel__body' }, el('p', { class: 'tp-h3' }, 'Not found'), el('p', { class: 'tp-muted' }, err.message),
        el('a', { class: 'tp-frame tp-btn', href: BASE }, 'All screamsheets'))));
    return {};
  }
  return detail(root, sheet, { project });
}

// --- shared --------------------------------------------------------------------------------

async function setRevealed(sheet, revealed) {
  const saved = await api.save({ ...sheet, revealed });
  toast(revealed ? `"${saved.headline}" is revealed to players` : `"${saved.headline}" is hidden from players`);
  return saved;
}

/** Push a screamsheet; a hidden one is revealed first (after asking). Resolves to the sheet as saved. */
async function pushSheet(sheet) {
  let current = sheet;
  const ok = await revealAndPush({ name: sheet.headline, revealed: sheet.revealed }, async () => {
    current = await api.save({ ...sheet, revealed: true });
  }, { mode: 'article', id: sheet.id });
  return ok ? current : sheet;
}

const visBadge = (revealed) => el('span', { class: `tp-badge ${revealed ? 'tp-badge--interactive' : ''}` }, revealed ? 'Revealed' : 'Hidden');

// --- list --------------------------------------------------------------------------------------

async function list(root) {
  let sheets = await api.list().catch((err) => (toastError(err), []));
  async function writeNew() {
    const entries = await allEntities().catch(() => []);
    const lead = await articleDialog({}, { entries, title: 'Write a screamsheet' });
    if (!lead) return;
    try {
      const saved = await api.create({ ...lead, layout: 'feed', section: 'local' });
      toast('Screamsheet saved under World › Screamsheets: add more articles and ads to its page', { tone: 'success' });
      location.hash = `${BASE}/${saved.id}`;
    } catch (err) {
      toastError(err);
    }
  }
  const draw = () => root.replaceChildren(
    el('div', { class: 'cv' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${sheets.length} screamsheet${sheets.length === 1 ? '' : 's'}`),
        el('span', { class: 'app-actions' },
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: writeNew, title: 'Start a screamsheet with a blank lead article you write yourself' }, '✎ Write your own'),
          el('a', { class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', href: `${BASE}/new`, title: 'Roll one up with the Screamsheet Generator, filled in with your own characters and places' }, '⚄ Generate one'))),
      sheets.length
        ? el('ul', { class: 'ssl' }, sheets.map((s) =>
            el('li', { class: `tp-frame tp-panel ssl__card ${s.revealed ? '' : 'is-hidden'}` },
              el('a', { class: 'ssl__open', href: `${BASE}/${s.id}` },
                el('span', { class: 'tp-label ssl__outlet' }, [s.outlet || 'Screamsheet', s.dateline].filter(Boolean).join(' · ')),
                el('span', { class: 'ssl__headline' }, s.headline),
                el('span', { class: 'tp-dim ssl__snippet' }, snippet(s.body, 160)),
                s.items?.length ? el('span', { class: 'tp-label ssl__more' }, `+ ${s.items.length} more on the page`) : null),
              el('span', { class: 'ssl__foot' },
                visBadge(s.revealed),
                pushButton('Push', async () => {
                  const after = await pushSheet(s);
                  sheets = sheets.map((x) => (x.id === after.id ? after : x));
                  draw();
                }, { ghost: true })))))
        : el('article', { class: 'tp-frame tp-panel app-placeholder' },
            el('div', { class: 'tp-panel__body' },
              el('p', { class: 'tp-h3' }, 'No screamsheets yet'),
              el('p', { class: 'tp-muted' }, 'Roll one up with the Screamsheet Generator (an article type, its paragraphs and headline, filled in with your own characters and places), or write your own.'),
              el('span', { class: 'app-actions' },
                el('a', { class: 'tp-frame tp-btn tp-btn--primary', href: `${BASE}/new` }, '⚄ Generate one'),
                el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: writeNew }, '✎ Write your own'))))));
  draw();
  document.title = 'TEMPEST · Screamsheets';
  return {};
}

// --- one screamsheet (an issue) ------------------------------------------------------------------

function detail(root, sheet, ctx) {
  let view = 'gm';
  let entries = [];
  allEntities().then((list) => ((entries = list), draw())).catch(() => null);
  const hrefOf = (ref) => {
    const e = entries.find((x) => x.id === ref);
    return e ? entryHref(e) : null;
  };

  async function save(next, message) {
    try {
      sheet = await api.save(next);
      if (message) toast(message, { tone: 'success' });
      draw();
    } catch (err) {
      toastError(err);
    }
  }
  const items = () => sheet.items ?? [];
  const setItem = (id, change) => save({ ...sheet, items: items().map((it) => (it.id === id ? { ...it, ...change } : it)) });

  // Each part's Reveal / Obscure / Hide control (the lead's own, or a piece's), saved straight away.
  const control = (itemId, part) => {
    const owner = itemId ? items().find((it) => it.id === itemId) : sheet;
    const p = owner?.parts?.[part] ?? { visibility: 'revealed' };
    return visibilityControl({
      name: SHEET_PARTS.find((x) => x.id === part).label, shown: false,
      state: { visibility: p.visibility, style: p.style, text: p.text },
      onPick: async (next) => {
        const parts = { ...(owner.parts ?? {}) };
        if (next.visibility === 'revealed') delete parts[part];
        else parts[part] = { visibility: next.visibility, style: next.style ?? p.style ?? 'redacted', text: next.text ?? p.text ?? '' };
        if (itemId) await setItem(itemId, { parts });
        else await save({ ...sheet, parts });
      },
    });
  };

  /** Edit a piece: rolled articles reopen in the generator; written ones and ads in a form. */
  async function editPiece(itemId) {
    const it = itemId ? items().find((x) => x.id === itemId) : sheet;
    if (it.type === 'ad') {
      const next = await adDialog(it);
      if (next) await setItem(itemId, next);
      return;
    }
    if (it.selection) return generator(root, { ...ctx, sheet, itemId: itemId ?? undefined });
    const next = await articleDialog(it, { entries, title: itemId ? 'Edit article' : 'Edit the lead article' });
    if (!next) return;
    if (itemId) await setItem(itemId, next);
    else await save({ ...sheet, ...next });
  }
  /** An article's picture: add, change, move (before / after the text) or remove it. */
  async function editPicture(itemId) {
    const it = itemId ? items().find((x) => x.id === itemId) : sheet;
    const next = await pictureDialog(it);
    if (!next) return;
    if (itemId) await setItem(itemId, next);
    else await save({ ...sheet, ...next });
  }
  async function move(itemId, by) {
    const list = [...items()];
    const i = list.findIndex((x) => x.id === itemId);
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await save({ ...sheet, items: list });
  }
  async function removePiece(itemId) {
    const it = items().find((x) => x.id === itemId);
    const name = it.type === 'ad' ? 'this ad' : `"${it.headline}"`;
    if (!(await confirmDialog({ title: `Remove ${name}?`, body: 'It comes off this page for good.', confirmLabel: 'Remove', danger: true }))) return;
    await save({ ...sheet, items: items().filter((x) => x.id !== itemId) }, 'Removed from the page');
  }

  /** A piece's tools on the GM page. */
  const tools = (itemId, piece) => {
    const btn = (label, title, onClick, cls = '') => el('button', { type: 'button', class: `tp-frame tp-btn tp-btn--sm ${cls}`, title, 'aria-label': title, onClick }, label);
    const pic = piece.type === 'ad' ? null : btn(piece.image ? '🖼 Picture' : '🖼 + Picture', piece.image ? 'Change, move or remove the picture' : 'Add a picture before or after the text', () => editPicture(itemId));
    if (!itemId) return [btn('✎ Edit', 'Edit the lead article', () => editPiece(null), 'tp-btn--interactive'), pic];
    const i = items().findIndex((x) => x.id === itemId);
    return [
      btn('✎', 'Edit', () => editPiece(itemId), 'tp-btn--interactive'),
      pic,
      btn('▲', 'Move up the page', () => move(itemId, -1)),
      btn('▼', 'Move down the page', () => move(itemId, 1)),
      btn(piece.hidden ? '◌ Hidden' : '◉', piece.hidden ? 'Kept from players: click to show it' : 'Players see it: click to keep it from them', () => setItem(itemId, { hidden: !piece.hidden }), piece.hidden ? 'tp-btn--danger' : ''),
      btn('✕', 'Remove from the page', () => removePiece(itemId), 'tp-btn--ghost'),
    ].filter((b, k) => b && !(k === 2 && i === 0) && !(k === 3 && i === items().length - 1));
  };

  async function addArticle(how) {
    if (how === 'roll') return generator(root, { ...ctx, sheet, itemId: 'new' });
    const next = await articleDialog({}, { entries, title: 'Write an article' });
    if (next) await save({ ...sheet, items: [...items(), { id: newItemId(), type: 'article', ...next }] }, 'Article added');
  }
  async function addAd() {
    const next = await adDialog({});
    if (next) await save({ ...sheet, items: [...items(), { id: newItemId(), type: 'ad', ...next }] }, 'Ad added');
  }
  async function editIssue() {
    const next = await issueDialog(sheet);
    if (next) await save({ ...sheet, ...next }, 'Issue saved');
  }

  const draw = () => {
    const seg = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'View as' },
      [['gm', 'GM view'], ['player', 'Player view']].map(([v, label]) =>
        el('button', { type: 'button', class: `fd-seg__btn ${view === v ? 'is-on' : ''}`, 'aria-pressed': String(view === v), onClick: () => ((view = v), draw()) }, label)));
    const pieces = items().length;
    root.replaceChildren(
      el('div', { class: 'cv' },
        el('div', { class: 'cv-bar' },
          el('a', { class: 'app-link', href: BASE }, '← All screamsheets'),
          el('span', { class: 'app-actions' },
            seg,
            visBadge(sheet.revealed),
            pushButton('Push', async () => ((sheet = await pushSheet(sheet)), draw()), { title: 'Show this screamsheet on the player screen' }),
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm',
              onClick: async () => {
                try {
                  sheet = await setRevealed(sheet, !sheet.revealed);
                  draw();
                } catch (err) {
                  toastError(err);
                }
              },
            }, sheet.revealed ? 'Hide from players' : 'Reveal to players'),
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost',
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Delete this screamsheet?', body: `"${sheet.headline}" and everything on its page will be deleted for good.`, confirmLabel: 'Delete', danger: true }))) return;
                try {
                  await api.remove(sheet.id);
                  toast('Screamsheet deleted');
                  location.hash = BASE;
                } catch (err) {
                  toastError(err);
                }
              },
            }, 'Delete'))),
        view === 'gm'
          ? el('div', { class: 'cv-bar ss-issue-bar' },
              el('span', { class: 'tp-deco' }, `${pieces + 1} piece${pieces ? 's' : ''} on this page`),
              el('span', { class: 'app-actions' },
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', title: 'Outlet, section, date line and look', onClick: editIssue }, '⚙ Issue'),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => addArticle('roll'), title: 'Roll another article with the Screamsheet Generator' }, '⚄ Roll an article'),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: () => addArticle('write') }, '✎ Write an article'),
                el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm', onClick: addAd }, '+ Ad')))
          : null,
        el('div', { class: 'ss-read' }, view === 'gm'
          ? renderIssue(sheet, { control, tools, linkHref: hrefOf, imageUrl })
          : renderIssue(playerCopy(sheet), { imageUrl })),
        el('p', { class: 'tp-dim cv-foot' }, `${sheet.edited ? 'Edited by hand' : sheet.selection ? 'Generated' : 'Written by hand'} · updated ${new Date(sheet.updatedAt).toLocaleString()}`)));
    document.title = `TEMPEST · ${sheet.headline}`;
  };
  draw();
  return {};
}

// --- dialogs: an article by hand, an ad, the issue ---------------------------------------------------

/** A form in a dialog; resolves to `read()`'s result on Save, or null. */
function formDialog(title, body, read, { wide = false } = {}) {
  return new Promise((resolve) => {
    const error = el('p', { class: 'app-error', role: 'alert', hidden: true });
    const dialog = el('dialog', { class: `tp-dialog app-dialog ${wide ? 'ss-dialog--wide' : ''}` },
      el('form', { method: 'dialog', class: 'tp-frame tp-panel' },
        el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, title)),
        el('div', { class: 'tp-panel__body ss-dialog' }, body, error),
        el('footer', { class: 'tp-panel__foot app-actions' },
          el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'cancel', formnovalidate: true }, 'Cancel'),
          el('button', { class: 'tp-frame tp-btn tp-btn--primary', value: 'ok' }, 'Save'))));
    const finish = (v) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.submitter?.value !== 'ok') return finish(null);
      try {
        finish(await read());
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
    dialog.addEventListener('cancel', (e) => (e.preventDefault(), finish(null)));
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('input, textarea')?.focus();
  });
}
const formField = (label, input, hint) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), input, hint ? el('span', { class: 'tp-dim ss__note' }, hint) : null);

/**
 * An article's picture fields: pick or upload, a caption, and where it goes. Returns
 * { nodes, read() → { image, caption, imagePos } }.
 */
function pictureFields(a) {
  let image = a.image ?? null;
  const preview = el('div', { class: 'ss-ad-pick' });
  const remove = el('button', { type: 'button', class: 'tp-btn tp-btn--ghost tp-btn--sm', onClick: () => ((image = null), show()) }, 'Remove picture');
  const show = () => {
    preview.replaceChildren(image ? el('img', { src: imageUrl(image), alt: '' }) : el('span', { class: 'tp-dim' }, 'No picture'));
    remove.hidden = !image;
  };
  show();
  const file = el('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', class: 'tp-input',
    onChange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        image = (await uploadImage(f)).id;
        show();
      } catch (err) {
        toastError(err);
      }
    },
  });
  const caption = el('input', { class: 'tp-input', value: a.caption ?? '', maxlength: 160, placeholder: 'e.g. Block 12, Watson, this morning' });
  const spot = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Where the picture goes' });
  let imagePos = a.imagePos ?? 'before';
  const drawSpot = () => spot.replaceChildren(...PICTURE_SPOTS.map((p) =>
    el('button', { type: 'button', class: `fd-seg__btn ${imagePos === p.id ? 'is-on' : ''}`, 'aria-pressed': String(imagePos === p.id), onClick: () => ((imagePos = p.id), drawSpot()) }, p.label)));
  drawSpot();
  return {
    nodes: [
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Picture'), preview, file, remove),
      formField('Caption', caption),
      el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Where it goes'), spot),
    ],
    read: () => ({ image, caption: image ? caption.value : '', imagePos }),
  };
}

/** Add, change, move or remove an article's picture: { image, caption, imagePos }, or null. */
function pictureDialog(a) {
  const pic = pictureFields(a);
  return formDialog(a.image ? 'Picture' : 'Add a picture', pic.nodes, () => pic.read());
}

/** Write (or edit) an article by hand: { headline, byline, body, image, caption, imagePos, links, notes }, or null. */
function articleDialog(a, { entries = [], title }) {
  const headline = el('input', { class: 'tp-input', value: a.headline ?? '', maxlength: 200, required: true });
  const byline = el('input', { class: 'tp-input', value: a.byline ?? '', maxlength: 80, placeholder: 'e.g. Ziggy \'Front\' Page' });
  const body = el('textarea', { class: 'tp-textarea', rows: 9, placeholder: 'A blank line starts a new paragraph.' }, a.body ?? '');
  const links = el('textarea', { class: 'tp-textarea', rows: 3, placeholder: 'One per line, e.g. Night City Restoration Committee' }, linksText(a.links));
  const notes = el('textarea', { class: 'tp-textarea', rows: 3, placeholder: 'e.g. Disclaimer: Faisal\'s Customs is not legally responsible…' }, notesText(a.notes));
  const pic = pictureFields(a);
  return formDialog(title, [
    formField('Headline', headline),
    formField('Byline', byline),
    formField('Article', body),
    ...pic.nodes,
    formField('Links', links, 'Printed as "Link: …". A line that names one of your entries exactly links to it (players can follow it once it\'s in their Codex).'),
    formField('Notes', notes, 'Bold-labelled extras, one per line: "Disclaimer: …", "Correction: …".'),
  ], () => {
    if (!headline.value.trim()) throw new Error('An article needs a headline.');
    return { headline: headline.value, byline: byline.value, body: body.value, ...pic.read(), links: parseLinks(links.value, entries), notes: parseNotes(notes.value) };
  }, { wide: true });
}

/** Make (or edit) an ad: { image, tagline, links }, or null. */
function adDialog(ad) {
  let image = ad.image ?? null;
  const preview = el('div', { class: 'ss-ad-pick' });
  const showImage = () => preview.replaceChildren(image ? el('img', { src: imageUrl(image), alt: '' }) : el('span', { class: 'tp-dim' }, 'No picture yet'));
  showImage();
  const file = el('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', class: 'tp-input',
    onChange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        image = (await uploadImage(f)).id;
        showImage();
      } catch (err) {
        toastError(err);
      }
    },
  });
  const tagline = el('textarea', { class: 'tp-textarea', rows: 3, maxlength: 200, placeholder: 'e.g. LITTLE DETECTIVE · BIG GUN\nTHE BAD GUYS NEVER SEE US COMING.' }, ad.tagline ?? '');
  const links = el('textarea', { class: 'tp-textarea', rows: 2, placeholder: 'e.g. Danger Gal' }, linksText(ad.links));
  return allEntities().catch(() => []).then((entries) => formDialog(ad.id ? 'Edit ad' : 'New ad', [
    el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Picture'), preview, file,
      image ? el('button', { type: 'button', class: 'tp-btn tp-btn--ghost tp-btn--sm', onClick: () => ((image = null), showImage()) }, 'Remove picture') : null),
    formField('Tagline', tagline),
    formField('Links', links, 'One per line; a line naming one of your entries links to it.'),
  ], () => {
    if (!image && !tagline.value.trim()) throw new Error('An ad needs a picture or a tagline.');
    return { image, tagline: tagline.value, links: parseLinks(links.value, entries) };
  }));
}

/** The issue's masthead and look: { outlet, section, dateline, layout }, or null. */
function issueDialog(sheet) {
  const outlet = el('input', { class: 'tp-input', value: sheet.outlet ?? '', maxlength: 80, placeholder: 'e.g. Night City Today' });
  const section = el('select', { class: 'tp-select' }, el('option', { value: '' }, 'None'), SECTIONS.map((x) => el('option', { value: x.id, selected: x.id === sheet.section }, x.label)));
  const dateline = el('input', { class: 'tp-input', value: sheet.dateline ?? '', maxlength: 80, placeholder: 'e.g. 4:52 PM, or Night City · Thursday' });
  const layout = el('select', { class: 'tp-select' }, LAYOUTS.map((l) => el('option', { value: l.id, selected: l.id === sheet.layout }, l.label)));
  return formDialog('Issue', [
    formField('Outlet', outlet, 'Its initials make the News feed\'s logo.'),
    formField('Section', section, 'The tab lit on the News feed\'s masthead.'),
    formField('Date line', dateline, 'On the News feed it sits in the status bar, like the time on a phone.'),
    formField('Look', layout),
  ], () => ({ outlet: outlet.value, section: section.value, dateline: dateline.value, layout: layout.value }));
}

// --- the generator --------------------------------------------------------------------------------

// With itemId, it rolls (or rerolls) one more article on an issue's page: 'new', or an item's id.
async function generator(root, { project, sheet = null, itemId = undefined }) {
  const host = el('div', { class: 'ss-gen' });
  root.replaceChildren(host);

  let packs = [];
  try {
    packs = await packsApi.list();
  } catch (err) {
    toastError(err);
  }
  if (!packs.length) return importPage(host, () => generator(root, { project, sheet, itemId }));

  let pack = packs[0];
  let selection = null;
  let dice = {};
  const piece = itemId === 'new' ? {} : itemId ? sheet.items.find((it) => it.id === itemId) ?? {} : null;
  const src = piece ?? sheet; // what's being rolled: one more piece of the page, or the lead
  const values = { ...(src?.values ?? {}) }; // fieldKey → text; kept across rerolls so [Name 1] stays filled
  let edited = src?.edited ? { headline: src.headline, body: src.body } : null;
  let outlet = sheet?.outlet ?? pack.outlets?.[0]?.name ?? '';
  let byline = src?.byline ?? '';
  let linksBlock = linksText(src?.links);
  let notesBlock = notesText(src?.notes);
  let section = sheet ? sheet.section ?? '' : 'local';
  let dateline = sheet?.dateline ?? '';
  let layout = sheet?.layout ?? 'feed';
  let revealed = sheet?.revealed ?? false;

  // Reopening one: its pack and picks, if they still exist.
  if (src?.selection) {
    pack = packs.find((p) => p.articleTypes.some((t) => t.id === src.selection.typeId)) ?? pack;
    if (compose(pack, src.selection)) selection = { ...src.selection };
  }
  if (!selection) ({ selection, dice } = generate(pack));

  // --- names from the project ------------------------------------------------------------
  const nightCity = UNIQUE_POI_MODES.includes(project?.settings?.maps?.mode) && project?.settings?.maps?.nightCity?.enabled !== false;
  const [entities, globe, city, districts] = await Promise.all([
    allEntities().catch(() => []),
    project?.settings?.maps?.mode === 'planetary' ? globePois.list().catch(() => []) : [],
    nightCity ? cityPois.list('nightcity').catch(() => []) : [],
    nightCity ? fetch('/assets/maps/nightcity/districts.json').then((r) => r.json()).then((d) => d.districts.map((x) => x.name)).catch(() => []) : [],
  ]);
  const people = entities.filter((e) => e.kind === 'characters').map((e) => e.name);
  const places = [...city.map((p) => p.name), ...globe.filter((p) => !p.unique).map((p) => p.name)];

  const stepsHost = el('div', { class: 'ss__steps' });
  const previewHost = el('div', { class: 'ss__preview' });

  const type = () => pack.articleTypes.find((t) => t.id === selection.typeId);
  const raw = () => compose(pack, selection);
  const fields = () => {
    const r = raw();
    return fieldsIn(r.headline, ...r.paragraphs);
  };
  function output() {
    if (edited) return edited;
    const r = raw();
    return { headline: fill(r.headline, values), body: r.paragraphs.map((p) => fill(p, values)).join('\n\n') };
  }
  const unfilled = (o) => fieldsIn(o.headline, o.body);

  /** Entry ids named in the fill-ins (GM-only "mentions"). */
  function mentions() {
    const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e.id]));
    return [...new Set(Object.values(values).map((v) => byName.get(String(v).trim().toLowerCase())).filter(Boolean))];
  }
  function suggestionsFor(field) {
    const kind = fieldKind(field.label);
    if (kind.kind === 'people') return people;
    if (kind.kind === 'places') return kind.district ? (districts.length ? districts : places) : [...places, ...districts];
    if (kind.kind === 'members') return memberSuggestions(values[kind.group]);
    return kind.options ?? [];
  }
  const randomFor = (field) => {
    const options = suggestionsFor(field);
    return options.length ? pick(options) : null;
  };

  // --- actions -----------------------------------------------------------------------------
  async function guardEdits() {
    if (!edited) return true;
    const ok = await confirmDialog({ title: 'Discard your edits?', body: 'Changing the rolls rebuilds the text and replaces your hand edits.', confirmLabel: 'Discard edits', danger: true });
    if (ok) edited = null;
    return ok;
  }
  async function reroll(keep) {
    if (!(await guardEdits())) return;
    ({ selection, dice } = generate(pack, keep));
    renderSteps();
    renderPreview();
  }
  async function choose(change) {
    if (!(await guardEdits())) return;
    selection = { ...selection, ...change };
    const options = headlineOptions(type(), selection.conclusion);
    if (!options.includes(selection.headline)) selection.headline = options[0];
    dice = {};
    renderSteps();
    renderPreview();
  }
  async function save(andPush) {
    const o = output();
    const left = unfilled(o);
    if (left.length && !(await confirmDialog({
      title: 'Some blanks are still empty',
      body: `${left.map((f) => `[${f.label}]`).join(', ')} will appear in brackets. Save anyway?`,
      confirmLabel: 'Save anyway',
    }))) return;
    const article = {
      headline: o.headline, body: o.body, byline, links: parseLinks(linksBlock, entities), notes: parseNotes(notesBlock),
      selection, values, edited: Boolean(edited), mentions: mentions(),
    };
    const draft = piece
      ? { ...sheet, revealed: andPush ? true : sheet.revealed, items: itemId === 'new' ? [...sheet.items, { id: newItemId(), type: 'article', ...article }] : sheet.items.map((it) => (it.id === itemId ? { ...it, ...article } : it)) }
      : { ...(sheet ?? {}), ...article, outlet, dateline, layout, section, revealed: andPush ? true : revealed };
    try {
      const saved = sheet ? await api.save(draft) : await api.create(draft);
      toast(piece ? (itemId === 'new' ? 'Article added to the page' : 'Article saved') : sheet ? 'Screamsheet saved' : 'Screamsheet saved under World › Screamsheets', { tone: 'success' });
      if (andPush) await push({ mode: 'article', id: saved.id });
      location.hash = `${BASE}/${saved.id}`;
    } catch (err) {
      toastError(err);
    }
  }

  // --- rendering -------------------------------------------------------------------------
  const step = (n, title, ...body) =>
    el('section', { class: 'tp-frame tp-panel' },
      el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title ss__step-title' }, el('span', { class: 'ss__step-num' }, n), title)),
      el('div', { class: 'tp-panel__body' }, ...body));
  const dieButton = (label, onClick, face) =>
    el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm ss__die', title: label, 'aria-label': label, onClick }, face ? `⚄ ${face}` : '⚄');
  const field = (label, input) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), input);

  function renderSteps() {
    const t = type();

    // 1. Type of article
    const typeButtons = pack.articleTypes.map((at) =>
      el('button', {
        type: 'button', class: `tp-frame tp-btn tp-btn--sm ${at.id === t.id ? 'tp-btn--interactive' : ''}`, 'aria-pressed': String(at.id === t.id),
        title: `Rolls ${at.rolls.join(', ')} on Table A`, onClick: () => at.id !== t.id && reroll({ typeId: at.id }),
      }, at.name));

    // 2. Content
    const parts = PARTS.map(([part, label]) => {
      const select = el('select', { class: 'tp-select', 'aria-label': `${label} paragraph`, onChange: (e) => choose({ [part]: Number(e.target.value) }) },
        t[TABLES[part]].map((_, i) => el('option', { value: String(i), selected: i === selection[part] }, `${i + 1} · ${snippet(partText(t, part, i))}`)));
      return el('div', { class: 'ss__part' },
        el('span', { class: 'tp-label' }, label),
        select,
        dieButton(`Reroll the ${label.toLowerCase()}`, () => reroll({ ...selection, [part]: undefined }), dice[part]));
    });

    // 3. Headline
    const headlines = el('div', { class: 'ss__headlines' },
      headlineOptions(t, selection.conclusion).map((code) =>
        el('label', { class: `ss__headline ${code === selection.headline ? 'is-on' : ''}` },
          el('input', { type: 'radio', name: 'ss-headline', checked: code === selection.headline, onChange: () => choose({ headline: code }) }),
          el('span', { class: 'tp-mono tp-dim' }, code), el('span', {}, t.headlines[code]))));

    // 4. Fill-ins
    const fieldNodes = fields().map((f) => {
      const kind = fieldKind(f.label);
      const listId = `ss-list-${f.key.replace(/[^a-z0-9]+/g, '-')}`;
      const suggestions = suggestionsFor(f);
      const input = el('input', {
        class: 'tp-input', value: values[f.key] ?? '', list: suggestions.length ? listId : null, placeholder: kind.kind === 'text' ? 'Type anything' : 'Pick or type',
        onInput: (e) => ((values[f.key] = e.target.value), renderPreview()),
      });
      const random = suggestions.length
        ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm ss__die', title: 'Pick one at random', 'aria-label': `Pick a ${f.label} at random`, onClick: () => ((input.value = values[f.key] = randomFor(f) ?? ''), renderPreview()) }, '⚄')
        : null;
      return el('div', { class: 'tp-field ss__field' },
        el('span', { class: 'tp-label' }, f.label),
        el('div', { class: 'app-row' }, input, random),
        suggestions.length ? el('datalist', { id: listId }, suggestions.map((s) => el('option', { value: s }))) : null);
    });
    const fillAll = el('button', {
      type: 'button', class: 'tp-frame tp-btn tp-btn--sm', title: 'Fill every empty blank that has suggestions',
      onClick: () => {
        for (const f of fields()) if (!values[f.key]?.trim()) values[f.key] = randomFor(f) ?? values[f.key] ?? '';
        renderSteps();
        renderPreview();
      },
    }, '⚄ Fill blanks from the project');

    // 5. Polish & publish
    const outletInput = el('input', {
      class: 'tp-input', list: 'ss-outlets', value: outlet, placeholder: 'e.g. a news outlet',
      onInput: (e) => {
        outlet = e.target.value;
        const known = pack.outlets?.find((x) => x.name.toLowerCase() === outlet.trim().toLowerCase());
        if (known) {
          layout = known.style;
          layoutSelect.value = layout;
        }
        renderPreview();
      },
    });
    const layoutSelect = el('select', { class: 'tp-select', onChange: (e) => ((layout = e.target.value), renderPreview()) },
      LAYOUTS.map((l) => el('option', { value: l.id, selected: l.id === layout }, l.label)));
    const players = el('span', { class: 'fd-seg', role: 'group', 'aria-label': 'Visibility to players' },
      [[false, 'Hidden'], [true, 'Revealed']].map(([v, label]) =>
        el('button', { type: 'button', class: `fd-seg__btn ${revealed === v ? 'is-on' : ''}`, 'aria-pressed': String(revealed === v), onClick: () => ((revealed = v), renderSteps()) }, label)));

    stepsHost.replaceChildren(
      el('div', { class: 'app-row ss__top' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: () => reroll({}) }, '⚄ Roll a whole article'),
        el('span', { class: 'ss__dice-log' }, Object.keys(dice).length ? `Rolled: ${Object.entries(dice).map(([k, v]) => `${k} ${v}`).join(' · ')}` : 'Hand-picked'),
        packs.length > 1
          ? el('select', { class: 'tp-select ss__pack', onChange: (e) => ((pack = packs.find((p) => p.id === e.target.value)), reroll({})) },
              packs.map((p) => el('option', { value: p.id, selected: p.id === pack.id }, p.name)))
          : null),
      step(1, 'Type of article', el('div', { class: 'app-row' }, typeButtons, dieButton('Roll on Table A', () => reroll({}), dice.type))),
      step(2, 'Content', el('div', { class: 'ss__parts' }, parts)),
      step(3, 'Headline', el('p', { class: 'tp-muted ss__note' }, 'Suggested by the conclusion.'), headlines,
        el('div', {}, dieButton('Roll among the suggestions', () => reroll({ ...selection, headline: undefined }), dice.headline))),
      step(4, 'Fill in the details',
        fieldNodes.length ? el('div', { class: 'ss__fields' }, fieldNodes) : el('p', { class: 'tp-muted' }, 'No blanks in this one.'),
        fieldNodes.length ? el('div', { class: 'app-row' }, fillAll, el('span', { class: 'tp-muted ss__note' }, 'People come from your characters; places from Night City\'s districts and your points of interest. Anything else is yours to invent.')) : null),
      step(5, 'Polish & publish',
        el('div', { class: 'ss__fields' },
          piece ? null : field('Outlet', outletInput),
          field('Byline', el('input', { class: 'tp-input', list: 'ss-bylines', value: byline, placeholder: 'Reporter', onInput: (e) => ((byline = e.target.value), renderPreview()) })),
          piece ? null : field('Date line', el('input', { class: 'tp-input', value: dateline, placeholder: 'e.g. 4:52 PM, or Night City · Thursday', maxlength: 80, onInput: (e) => ((dateline = e.target.value), renderPreview()) })),
          piece ? null : field('Section', el('select', { class: 'tp-select', onChange: (e) => ((section = e.target.value), renderPreview()) },
            el('option', { value: '' }, 'None'), SECTIONS.map((x) => el('option', { value: x.id, selected: x.id === section }, x.label)))),
          piece ? null : field('Look', layoutSelect),
          piece ? null : el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'), players)),
        el('div', { class: 'ss__fields ss__fields--wide' },
          field('Links', el('textarea', { class: 'tp-textarea', rows: 2, placeholder: 'One per line, e.g. Night City Restoration Committee', onInput: (e) => ((linksBlock = e.target.value), renderPreview()) }, linksBlock)),
          field('Notes', el('textarea', { class: 'tp-textarea', rows: 2, placeholder: 'e.g. Disclaimer: …', onInput: (e) => ((notesBlock = e.target.value), renderPreview()) }, notesBlock))),
        el('p', { class: 'tp-dim ss__note' }, 'Links print as "Link: …"; a line naming one of your entries links to it. Notes print bold-labelled, one per line: "Disclaimer: …", "Correction: …".'),
        el('datalist', { id: 'ss-outlets' }, (pack.outlets ?? []).map((x) => el('option', { value: x.name }))),
        el('datalist', { id: 'ss-bylines' }, (pack.bylines ?? []).map((b) => el('option', { value: b.name }, b.beat ?? ''))),
        el('div', { class: 'app-row ss__actions' },
          edited
            ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => ((edited = null), renderSteps(), renderPreview()) }, 'Discard hand edits')
            : el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: () => ((edited = output()), renderSteps(), renderPreview()) }, 'Edit the text by hand'),
          el('span', { class: 'ss__spacer' }),
          sheet ? el('a', { class: 'tp-frame tp-btn tp-btn--ghost', href: `${BASE}/${sheet.id}`, onClick: (e) => (e.preventDefault(), detail(root, sheet, { project })) }, 'Cancel') : null,
          el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: () => save(false) }, 'Save'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', title: 'Saves it revealed and shows it on the player screen', onClick: () => save(true) }, '⇪ Save & push to players'))),
    );
  }

  function renderPreview() {
    const o = output();
    const left = unfilled(o);
    const head = el('div', { class: 'app-row' },
      el('span', { class: 'tp-label' }, 'Preview'),
      left.length ? el('span', { class: 'ss__unfilled tp-label' }, `${left.length} blank${left.length === 1 ? '' : 's'} to fill`) : el('span', { class: 'tp-badge tp-badge--interactive' }, 'Ready'));
    // The whole page, with this article in its place.
    const issueWith = (text) => {
      const article = { ...text, byline, links: parseLinks(linksBlock, entities), notes: parseNotes(notesBlock) };
      if (!piece) return { ...(sheet ?? {}), ...article, parts: sheet?.parts ?? {}, outlet, dateline, layout, section, items: sheet?.items ?? [] };
      const items = itemId === 'new' ? [...sheet.items, { id: 'it_preview', type: 'article', ...article }] : sheet.items.map((it) => (it.id === itemId ? { ...it, ...article } : it));
      return { ...sheet, items };
    };
    const paper = () => renderIssue(issueWith({ headline: o.headline, body: o.body }), { imageUrl });
    if (!edited) return previewHost.replaceChildren(head, paper());
    const holder = el('div', {}, paper());
    const repaint = () => holder.replaceChildren(renderIssue(issueWith({ headline: edited.headline, body: edited.body }), { imageUrl }));
    previewHost.replaceChildren(head,
      el('input', { class: 'tp-input', value: edited.headline, 'aria-label': 'Headline', onInput: (e) => ((edited.headline = e.target.value), repaint()) }),
      el('textarea', { class: 'tp-textarea', rows: 14, 'aria-label': 'Article text', onInput: (e) => ((edited.body = e.target.value), repaint()) }, edited.body),
      el('p', { class: 'tp-dim ss__note' }, 'A blank line starts a new paragraph.'),
      holder);
  }

  host.replaceChildren(
    el('div', { class: 'cv-bar' },
      el('a', { class: 'app-link', href: sheet ? `${BASE}/${sheet.id}` : BASE }, sheet ? '← Back to the screamsheet' : '← All screamsheets'),
      piece ? el('span', { class: 'tp-label' }, itemId === 'new' ? 'Rolling one more article for this page' : 'Rerolling an article on this page') : null,
      el('span', { class: 'tp-deco' }, `${pack.name}${pack.source ? ` // imported from ${pack.source}` : ''}`)),
    el('div', { class: 'ss' }, stepsHost, previewHost));
  renderSteps();
  renderPreview();
  document.title = 'TEMPEST · Screamsheet Generator';
  return {};
}

/** No tables yet: import them from the GM's own PDF. */
async function importPage(host, done) {
  const sources = await packsApi.sources().catch(() => []);
  const input = el('input', { class: 'tp-input', value: sources[0] ?? '', placeholder: 'C:\\…\\RTG-CPR-DLC-ScreamsheetGenerator.pdf' });
  const status = el('p', { class: 'tp-muted', role: 'status' });
  const go = el('button', {
    type: 'button', class: 'tp-frame tp-btn tp-btn--primary',
    onClick: async () => {
      go.disabled = true;
      status.textContent = 'Reading the PDF…';
      try {
        const res = await packsApi.import(input.value);
        toast(`Imported ${res.articleTypes?.length ?? 'the'} article types`, { tone: 'success' });
        done();
      } catch (err) {
        status.textContent = '';
        toastError(err);
        go.disabled = false;
      }
    },
  }, 'Import tables');
  host.replaceChildren(el('section', { class: 'tp-frame tp-panel' },
    el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title' }, 'Import the Screamsheet Generator tables')),
    el('div', { class: 'tp-panel__body' },
      el('p', {}, 'The generator uses the tables from R. Talsorian Games\' free Screamsheet Generator for Cyberpunk RED. TEMPEST doesn\'t ship that text: it reads it from your copy of the PDF and keeps it in your local data folder. Needs Python 3 with pypdf.'),
      sources.length ? el('p', { class: 'tp-muted' }, `Found in official_references: ${sources.length} file${sources.length === 1 ? '' : 's'}.`) : null,
      el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'PDF location'), input),
      el('div', { class: 'app-row' }, go),
      status)));
  return {};
}
