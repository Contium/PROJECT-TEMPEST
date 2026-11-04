// Screamsheet generator: the five steps from R. Talsorian's Screamsheet Generator
// (type, content, headline, fill-ins, polish), with a live preview. Tables come
// from a pack built from the GM's own PDF; results save as Article entities and
// can be pushed to the player screen.

import { api } from '../api.js';
import { el, frame, panelHead, toast, toastError, confirmDialog } from '../ui.js';
import { renderArticle, LAYOUTS } from '../article.js';
import { pushEntity } from '../push.js';
import { generate, compose, fieldsIn, fill, fieldKey, fieldKind, memberSuggestions, headlineOptions, partText, roll } from '../generators/screamsheet.js';

const PARTS = [['intro', 'Intro'], ['body', 'Body'], ['conclusion', 'Conclusion']];
const TABLES = { intro: 'intros', body: 'bodies', conclusion: 'conclusions' };
const pick = (list) => list[roll(list.length) - 1];
const snippet = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text).replace(/\s+/g, ' ');

export async function mount(root, ctx) {
  const page = el('div', { class: 'app-page' });
  root.append(page);

  let packs = [];
  let pack = null;
  let selection = null;
  let dice = {};
  const values = {}; // fieldKey → text; kept across rerolls so [Name 1] stays filled
  let edited = null; // { headline, body } once the GM edits the text by hand
  let outlet = '';
  let byline = '';
  let layout = 'broadsheet';
  let visibility = 'known';

  const stepsHost = el('div', { class: 'ss__steps' });
  const previewHost = el('div', { class: 'ss__preview' });

  // --- derived ------------------------------------------------------------------

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

  // --- universe suggestions ----------------------------------------------------------

  let names = new Map();
  const candidates = (types) => [...names.values()].filter((e) => !e.deleted && types.includes(e.type));

  /** Entity ids named in the fill-ins, for the Article's Mentions. */
  function mentions() {
    const byName = new Map([...names.values()].filter((e) => !e.deleted && e.type !== 'relation').map((e) => [e.name.toLowerCase(), e.id]));
    return [...new Set(Object.values(values).map((v) => byName.get(String(v).trim().toLowerCase())).filter(Boolean))];
  }

  function suggestionsFor(field) {
    const kind = fieldKind(field.label);
    if (kind.kind === 'entity') return candidates(kind.types).map((e) => e.name);
    if (kind.kind === 'members') return memberSuggestions(values[kind.group]);
    return kind.options ?? [];
  }

  function randomFor(field) {
    const options = suggestionsFor(field);
    return options.length ? pick(options) : null;
  }

  // --- actions -----------------------------------------------------------------------

  async function guardEdits() {
    if (!edited) return true;
    const ok = await confirmDialog({ title: 'Discard your edits?', body: 'Changing the rolls rebuilds the text and replaces your hand edits.', confirmLabel: 'Discard edits', danger: true });
    if (ok) edited = null;
    return ok;
  }

  async function reroll(keep) {
    if (!(await guardEdits())) return;
    const result = generate(pack, keep);
    selection = result.selection;
    dice = result.dice;
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

  async function save(push) {
    const o = output();
    const left = unfilled(o);
    if (left.length) {
      const ok = await confirmDialog({
        title: 'Some blanks are still empty',
        body: `${left.map((f) => `[${f.label}]`).join(', ')} will appear in brackets. Save anyway?`,
        confirmLabel: 'Save anyway',
      });
      if (!ok) return;
    }
    try {
      const res = await ctx.api.batch({
        note: `${ctx.typeLabel('article')}: ${o.headline}`,
        ops: [{
          op: 'create', type: 'article', name: o.headline, visibility,
          data: { outlet: outlet || null, byline: byline || null, layout, body: o.body, mentions: mentions() },
        }],
      });
      const saved = res.entities[0];
      toast(`${ctx.typeLabel('article')} saved`, { tone: 'success', action: { label: 'Open', run: () => ctx.go(`${ctx.base}/e/article/${saved.id}`) } });
      if (push) await pushEntity(ctx, saved);
    } catch (err) {
      toastError(err);
    }
  }

  // --- rendering -------------------------------------------------------------------

  const step = (n, title, ...body) =>
    frame('', el('header', { class: 'tp-panel__head' }, el('h2', { class: 'tp-panel__title ss__step-title' }, el('span', { class: 'ss__step-num' }, n), title)),
      el('div', { class: 'tp-panel__body' }, ...body));

  const dieButton = (label, onClick, face) =>
    el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--sm ss__die', title: label, onClick }, face ? `⚄ ${face}` : '⚄ Roll');

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
      const select = el('select', { class: 'tp-select', 'aria-label': `${label} paragraph`, value: String(selection[part]) },
        t[TABLES[part]].map((_, i) => el('option', { value: String(i) }, `${i + 1} · ${snippet(partText(t, part, i))}`)));
      select.addEventListener('change', () => choose({ [part]: Number(select.value) }));
      return el('div', { class: 'ss__part' },
        el('span', { class: 'tp-label' }, label),
        select,
        dieButton(`Reroll the ${label.toLowerCase()}`, () => reroll({ ...selection, [part]: undefined }), dice[part]));
    });

    // 3. Headline
    const options = headlineOptions(t, selection.conclusion);
    const headlines = el('div', { class: 'app-stack' },
      options.map((code) =>
        el('label', { class: 'tp-check' },
          el('input', { type: 'radio', name: 'ss-headline', checked: code === selection.headline, onChange: () => choose({ headline: code }) }),
          el('span', {}, el('span', { class: 'tp-mono tp-dim' }, `${code} `), t.headlines[code]))));

    // 4. Fill-ins
    const fieldNodes = fields().map((f) => {
      const kind = fieldKind(f.label);
      const listId = `ss-list-${f.key.replace(/[^a-z0-9]+/g, '-')}`;
      const suggestions = suggestionsFor(f);
      const input = el('input', { class: 'tp-input', value: values[f.key] ?? '', list: suggestions.length ? listId : null, placeholder: kind.kind === 'text' ? 'Type anything' : 'Pick or type' });
      input.addEventListener('input', () => {
        values[f.key] = input.value;
        renderPreview();
      });
      const random = kind.kind !== 'text' && suggestions.length
        ? el('button', {
            type: 'button', class: 'tp-frame tp-btn tp-btn--sm', title: 'Pick one at random',
            onClick: () => {
              input.value = values[f.key] = randomFor(f) ?? '';
              renderPreview();
            },
          }, '⚄')
        : null;
      return el('div', { class: 'tp-field ss__field' },
        el('span', { class: 'tp-label' }, f.label),
        el('div', { class: 'app-row' }, input, random),
        suggestions.length ? el('datalist', { id: listId }, suggestions.map((s) => el('option', { value: s }))) : null);
    });
    const fillAll = el('button', {
      type: 'button', class: 'tp-frame tp-btn tp-btn--sm', title: 'Fill every empty blank that has universe suggestions',
      onClick: () => {
        for (const f of fields()) if (!values[f.key]?.trim()) values[f.key] = randomFor(f) ?? values[f.key] ?? '';
        renderSteps();
        renderPreview();
      },
    }, 'Fill blanks from universe');

    // 5. Polish
    const outletInput = el('input', { class: 'tp-input', list: 'ss-outlets', value: outlet, placeholder: 'e.g. Night City Today' });
    outletInput.addEventListener('input', () => {
      outlet = outletInput.value;
      const known = pack.outlets?.find((x) => x.name.toLowerCase() === outlet.trim().toLowerCase());
      if (known) {
        layout = known.style;
        layoutSelect.value = layout;
      }
      renderPreview();
    });
    const bylineInput = el('input', { class: 'tp-input', list: 'ss-bylines', value: byline, placeholder: 'Reporter' });
    bylineInput.addEventListener('input', () => ((byline = bylineInput.value), renderPreview()));
    const layoutSelect = el('select', { class: 'tp-select', value: layout }, LAYOUTS.map(([id, label]) => el('option', { value: id }, label)));
    layoutSelect.addEventListener('change', () => ((layout = layoutSelect.value), renderPreview()));
    const visSelect = el('select', { class: 'tp-select', value: visibility },
      el('option', { value: 'known' }, 'Players can see it'), el('option', { value: 'rumored' }, 'Rumoured'), el('option', { value: 'hidden' }, 'GM only (prep)'));
    visSelect.addEventListener('change', () => (visibility = visSelect.value));
    const field = (label, input) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), input);

    stepsHost.replaceChildren(
      el('div', { class: 'app-row' },
        el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: () => reroll({}) }, '⚄ Roll a whole article'),
        el('span', { class: 'ss__dice-log' }, Object.keys(dice).length ? `Rolled: ${Object.entries(dice).map(([k, v]) => `${k} ${v}`).join(' · ')}` : 'Hand-picked'),
        packs.length > 1
          ? el('select', { class: 'tp-select', style: 'margin-left:auto;width:auto', value: pack.id, onChange: (e) => ((pack = packs.find((p) => p.id === e.target.value)), reroll({})) },
              packs.map((p) => el('option', { value: p.id }, p.name)))
          : null),
      step(1, 'Type of article', el('div', { class: 'app-row' }, typeButtons, dieButton('Roll on Table A', () => reroll({}), dice.type))),
      step(2, 'Content', el('div', { class: 'app-stack' }, parts)),
      step(3, 'Headline', el('p', { class: 'tp-muted', style: 'margin:0' }, 'Suggested by the conclusion.'), headlines,
        el('div', {}, dieButton('Roll among the suggestions', () => reroll({ ...selection, headline: undefined }), dice.headline))),
      step(4, 'Fill in the details',
        fieldNodes.length ? el('div', { class: 'ss__fields' }, fieldNodes) : el('p', { class: 'tp-muted' }, 'No blanks in this one.'),
        fieldNodes.length ? el('div', { class: 'app-row' }, fillAll, el('span', { class: 'tp-muted' }, 'Names, groups and places come from this universe. Anything else (an [Adjective], say) is yours or your players\' to invent.')) : null),
      step(5, 'Polish & publish',
        el('div', { class: 'ss__fields' }, field('Outlet', outletInput), field('Byline', bylineInput), field('Layout', layoutSelect), field('Who can see it', visSelect)),
        el('datalist', { id: 'ss-outlets' }, (pack.outlets ?? []).map((x) => el('option', { value: x.name }))),
        el('datalist', { id: 'ss-bylines' }, (pack.bylines ?? []).map((b) => el('option', { value: b.name }, b.beat))),
        el('div', { class: 'app-row' },
          edited
            ? el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--ghost', onClick: () => ((edited = null), renderSteps(), renderPreview()) }, 'Discard hand edits')
            : el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: () => ((edited = output()), renderSteps(), renderPreview()) }, 'Edit the text by hand'),
          el('span', { style: 'flex:1' }),
          el('button', { type: 'button', class: 'tp-frame tp-btn', onClick: () => save(false) }, 'Save'),
          el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary', onClick: () => save(true) }, 'Save & push to players'))),
    );
  }

  function renderPreview() {
    const o = output();
    const left = unfilled(o);
    const head = el('div', { class: 'app-row' },
      el('span', { class: 'tp-label' }, 'Preview'),
      left.length ? el('span', { class: 'ss__unfilled tp-label' }, `${left.length} blank${left.length === 1 ? '' : 's'} to fill`) : el('span', { class: 'tp-badge tp-badge--success' }, 'Ready'));

    if (!edited) {
      previewHost.replaceChildren(head, renderArticle({ headline: o.headline, body: o.body, outlet, byline, layout, dateLabel: ctx.meta.clockLabel }));
      return;
    }
    const headlineInput = el('input', { class: 'tp-input', value: edited.headline, 'aria-label': 'Headline' });
    const bodyInput = el('textarea', { class: 'tp-textarea', value: edited.body, rows: 14, 'aria-label': 'Article text' });
    const paper = el('div');
    const paint = () => paper.replaceChildren(renderArticle({ headline: edited.headline, body: edited.body, outlet, byline, layout, dateLabel: ctx.meta.clockLabel }));
    headlineInput.addEventListener('input', () => ((edited.headline = headlineInput.value), paint()));
    bodyInput.addEventListener('input', () => ((edited.body = bodyInput.value), paint()));
    paint();
    previewHost.replaceChildren(head, headlineInput, bodyInput, el('p', { class: 'ed__hint' }, 'Blank line = new paragraph.'), paper);
  }

  // --- import (no pack yet) --------------------------------------------------------

  async function renderImport(message) {
    const sources = await api('/packs/screamsheet/sources').catch(() => []);
    const input = el('input', { class: 'tp-input', value: sources[0] ?? '', placeholder: 'C:\\…\\RTG-CPR-DLC-ScreamsheetGenerator.pdf' });
    const status = el('p', { class: 'tp-muted', role: 'status' }, message ?? '');
    const go = el('button', { type: 'button', class: 'tp-frame tp-btn tp-btn--primary' }, 'Import tables');
    go.addEventListener('click', async () => {
      go.disabled = true;
      status.textContent = 'Reading the PDF…';
      try {
        const res = await api('/packs/screamsheet/import', { method: 'POST', body: { path: input.value } });
        toast(`Imported ${res.articleTypes.length} article types and ${res.bylines} bylines`, { tone: 'success' });
        await load();
      } catch (err) {
        status.textContent = '';
        toastError(err);
        go.disabled = false;
      }
    });
    page.replaceChildren(
      el('div', { class: 'app-page__head' }, el('h1', { class: 'tp-h1' }, 'Screamsheet Generator')),
      frame('', panelHead('Import the tables'),
        el('div', { class: 'tp-panel__body' },
          el('p', {}, 'The generator uses the tables from R. Talsorian Games\' free Screamsheet Generator for Cyberpunk RED. TEMPEST doesn\'t ship that text; it reads it from your copy of the PDF and keeps it in your local data folder.'),
          sources.length ? el('p', { class: 'tp-muted' }, `Found in official_references: ${sources.length} file${sources.length === 1 ? '' : 's'}.`) : null,
          el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, 'PDF location'), input),
          el('div', { class: 'app-row' }, go),
          status)),
    );
  }

  async function load() {
    packs = await api('/packs/screamsheet');
    if (!packs.length) return renderImport();
    pack = packs.find((p) => p.id === pack?.id) ?? packs[0];
    names = await ctx.names();
    if (!outlet && pack.outlets?.length) {
      outlet = pack.outlets[0].name;
      layout = pack.outlets[0].style;
    }
    if (!selection) ({ selection, dice } = generate(pack));
    page.replaceChildren(
      el('div', { class: 'app-page__head' },
        el('div', {}, el('h1', { class: 'tp-h1' }, 'Screamsheet Generator'), el('span', { class: 'tp-deco' }, `${pack.name} // imported from ${pack.source}`))),
      el('div', { class: 'ss' }, stepsHost, previewHost),
    );
    renderSteps();
    renderPreview();
  }

  await load();
  return {
    // Universe changed (e.g. a new contact): refresh suggestions without losing the draft.
    async update() {
      if (!pack) return;
      names = await ctx.names();
      renderSteps();
    },
  };
}
