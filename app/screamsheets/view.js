// World › Screamsheets: in-world news.
//   #/world/screamsheets          every screamsheet in the project, newest first
//   #/world/screamsheets/new      the Screamsheet Generator
//   #/world/screamsheets/<id>     one screamsheet: read it, push it, reveal it, edit it
//
// The generator follows the five steps of R. Talsorian's Screamsheet Generator
// (type, content, headline, fill-ins, polish), with a live preview. Its tables
// come from a pack built from the GM's own PDF (scripts/import_screamsheet.py).
// Blanks suggest names from the project: characters for people, Night City's
// districts and the project's points of interest for places.

import { el, toast, toastError, confirmDialog } from '../ui.js';
import { screamsheets as api, packs as packsApi, allEntities, pois as globePois, cityPois } from '../api.js';
import { push, revealAndPush, pushButton } from '../push/push.js';
import { renderArticle } from './article.js';
import { LAYOUTS } from './screamsheet-model.js';
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
  const draw = () => root.replaceChildren(
    el('div', { class: 'cv' },
      el('div', { class: 'cv-bar' },
        el('span', { class: 'tp-deco' }, `${sheets.length} screamsheet${sheets.length === 1 ? '' : 's'}`),
        el('a', { class: 'tp-frame tp-btn tp-btn--primary tp-btn--sm', href: `${BASE}/new` }, '⚄ New screamsheet')),
      sheets.length
        ? el('ul', { class: 'ssl' }, sheets.map((s) =>
            el('li', { class: `tp-frame tp-panel ssl__card ${s.revealed ? '' : 'is-hidden'}` },
              el('a', { class: 'ssl__open', href: `${BASE}/${s.id}` },
                el('span', { class: 'tp-label ssl__outlet' }, [s.outlet || 'Screamsheet', s.dateline].filter(Boolean).join(' · ')),
                el('span', { class: 'ssl__headline' }, s.headline),
                el('span', { class: 'tp-dim ssl__snippet' }, snippet(s.body, 160))),
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
              el('p', { class: 'tp-muted' }, 'Roll one up with the Screamsheet Generator: an article type, its paragraphs and headline, filled in with your own characters and places.'),
              el('a', { class: 'tp-frame tp-btn tp-btn--primary', href: `${BASE}/new` }, '⚄ New screamsheet')))));
  draw();
  document.title = 'TEMPEST · Screamsheets';
  return {};
}

// --- one screamsheet -----------------------------------------------------------------------------

function detail(root, sheet, ctx) {
  const draw = () => {
    root.replaceChildren(
      el('div', { class: 'cv' },
        el('div', { class: 'cv-bar' },
          el('a', { class: 'app-link', href: BASE }, '← All screamsheets'),
          el('span', { class: 'app-actions' },
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
            el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--interactive', onClick: () => generator(root, { ...ctx, sheet }) }, 'Edit'),
            el('button', {
              type: 'button', class: 'tp-frame tp-btn tp-btn--sm tp-btn--ghost',
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Delete this screamsheet?', body: `"${sheet.headline}" will be deleted for good.`, confirmLabel: 'Delete', danger: true }))) return;
                try {
                  await api.remove(sheet.id);
                  toast('Screamsheet deleted');
                  location.hash = BASE;
                } catch (err) {
                  toastError(err);
                }
              },
            }, 'Delete'))),
        el('div', { class: 'ss-read' }, renderArticle(sheet)),
        el('p', { class: 'tp-dim cv-foot' }, `${sheet.edited ? 'Edited by hand' : 'Generated'} · updated ${new Date(sheet.updatedAt).toLocaleString()}`)));
    document.title = `TEMPEST · ${sheet.headline}`;
  };
  draw();
  return {};
}

// --- the generator --------------------------------------------------------------------------------

async function generator(root, { project, sheet = null }) {
  const host = el('div', { class: 'ss-gen' });
  root.replaceChildren(host);

  let packs = [];
  try {
    packs = await packsApi.list();
  } catch (err) {
    toastError(err);
  }
  if (!packs.length) return importPage(host, () => generator(root, { project, sheet }));

  let pack = packs[0];
  let selection = null;
  let dice = {};
  const values = { ...(sheet?.values ?? {}) }; // fieldKey → text; kept across rerolls so [Name 1] stays filled
  let edited = sheet?.edited ? { headline: sheet.headline, body: sheet.body } : null;
  let outlet = sheet?.outlet ?? pack.outlets?.[0]?.name ?? '';
  let byline = sheet?.byline ?? '';
  let dateline = sheet?.dateline ?? '';
  let layout = sheet?.layout ?? pack.outlets?.[0]?.style ?? 'broadsheet';
  let revealed = sheet?.revealed ?? false;

  // Reopening one: its pack and picks, if they still exist.
  if (sheet?.selection) {
    pack = packs.find((p) => p.articleTypes.some((t) => t.id === sheet.selection.typeId)) ?? pack;
    if (compose(pack, sheet.selection)) selection = { ...sheet.selection };
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
    const draft = {
      ...(sheet ?? {}),
      headline: o.headline, body: o.body, outlet, byline, dateline, layout,
      revealed: andPush ? true : revealed,
      selection, values, edited: Boolean(edited), mentions: mentions(),
    };
    try {
      const saved = sheet ? await api.save(draft) : await api.create(draft);
      toast(sheet ? 'Screamsheet saved' : 'Screamsheet saved under World › Screamsheets', { tone: 'success' });
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
          field('Outlet', outletInput),
          field('Byline', el('input', { class: 'tp-input', list: 'ss-bylines', value: byline, placeholder: 'Reporter', onInput: (e) => ((byline = e.target.value), renderPreview()) })),
          field('Date line', el('input', { class: 'tp-input', value: dateline, placeholder: 'e.g. Night City · Thursday', maxlength: 80, onInput: (e) => ((dateline = e.target.value), renderPreview()) })),
          field('Layout', layoutSelect),
          el('div', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'Players'), players)),
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
    const paper = () => renderArticle({ headline: o.headline, body: o.body, outlet, byline, dateline, layout });
    if (!edited) return previewHost.replaceChildren(head, paper());
    const holder = el('div', {}, paper());
    const repaint = () => holder.replaceChildren(renderArticle({ headline: edited.headline, body: edited.body, outlet, byline, dateline, layout }));
    previewHost.replaceChildren(head,
      el('input', { class: 'tp-input', value: edited.headline, 'aria-label': 'Headline', onInput: (e) => ((edited.headline = e.target.value), repaint()) }),
      el('textarea', { class: 'tp-textarea', rows: 14, 'aria-label': 'Article text', onInput: (e) => ((edited.body = e.target.value), repaint()) }, edited.body),
      el('p', { class: 'tp-dim ss__note' }, 'A blank line starts a new paragraph.'),
      holder);
  }

  host.replaceChildren(
    el('div', { class: 'cv-bar' },
      el('a', { class: 'app-link', href: sheet ? `${BASE}/${sheet.id}` : BASE }, sheet ? '← Back to the screamsheet' : '← All screamsheets'),
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
