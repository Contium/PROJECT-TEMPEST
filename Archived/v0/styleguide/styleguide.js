import { ThemeEngine } from '/src/theme-engine/theme-engine.js';

const engine = new ThemeEngine();
const select = document.getElementById('theme-select');

function swatch({ name, hex, role }) {
  const el = document.createElement('div');
  el.className = 'sg-swatch';
  el.innerHTML = `
    <div class="sg-swatch__chip"></div>
    <div class="sg-swatch__info">
      <span class="sg-swatch__name"></span>
      <span class="tp-mono tp-muted"></span>
      <span class="sg-swatch__role"></span>
    </div>`;
  el.querySelector('.sg-swatch__chip').style.background = hex;
  el.querySelector('.sg-swatch__name').textContent = name;
  el.querySelector('.tp-mono').textContent = hex.toUpperCase();
  el.querySelector('.sg-swatch__role').textContent = role ?? '';
  return el;
}

function renderThemeDetails(theme) {
  const lineage = theme.extends ? ` // EXTENDS ${theme.extends.toUpperCase()}` : '';
  document.getElementById('theme-meta').textContent = `${theme.id.toUpperCase()} // v${theme.version}${lineage}`;
  document.getElementById('theme-description').textContent = theme.description ?? '';
  document.getElementById('palette-main').replaceChildren(...(theme.palette?.main ?? []).map(swatch));
  document.getElementById('palette-secondary').replaceChildren(...(theme.palette?.secondary ?? []).map(swatch));

  const rows = Object.entries(theme.lexicon ?? {}).map(([key, term]) => {
    const tr = document.createElement('tr');
    const k = document.createElement('td');
    const v = document.createElement('td');
    k.className = 'tp-mono tp-muted';
    k.textContent = key;
    v.textContent = term;
    tr.append(k, v);
    return tr;
  });
  document.getElementById('lexicon-rows').replaceChildren(...rows);
  document.title = `TEMPEST Style Guide · ${theme.name}`;
}

function renderPicker(themes) {
  select.replaceChildren(
    ...themes.map((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      return opt;
    }),
  );
}

engine.addEventListener('registry', (e) => renderPicker(e.detail));
engine.addEventListener('change', (e) => {
  select.value = e.detail.theme.id;
  renderThemeDetails(e.detail.theme);
});

select.addEventListener('change', () => engine.apply(select.value));

const effectsSelect = document.getElementById('effects-select');
engine.addEventListener('effects', (e) => (effectsSelect.value = e.detail.level));
effectsSelect.addEventListener('change', () => engine.setEffects(effectsSelect.value));

// Ctrl+Alt+T cycles installed themes.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey && e.altKey && e.key.toLowerCase() === 't')) return;
  const themes = engine.list();
  const i = themes.findIndex((t) => t.id === engine.current?.id);
  engine.apply(themes[(i + 1) % themes.length].id);
});

// Demo tabs
document.getElementById('demo-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tp-tab');
  if (!tab) return;
  e.currentTarget.querySelectorAll('.tp-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
});

document.getElementById('open-dialog').addEventListener('click', () => {
  document.getElementById('demo-dialog').showModal();
});

// Live composite — renders the sample universe through the world API when it exists.
const SAMPLE = 'cyberpunk-red-sample';
const TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const METER_TONES = ['', 'tp-meter--warning', 'tp-meter--interactive', 'tp-meter--success'];
let dossierView = 'gm';

const api = (path) => fetch(`/api/universes/${SAMPLE}${path}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function clockTime(minutes, calendar) {
  if (calendar?.type === 'gregorian') return new Date(Date.parse(`${calendar.epoch}Z`) + minutes * 60_000).toISOString().slice(11, 16);
  const rem = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`;
}

function visibilityBadge(entity) {
  if (entity.visibility === 'hidden') return el('span', { class: 'tp-badge tp-badge--danger' }, 'GM only');
  if (entity.visibility === 'rumored') return el('span', { class: 'tp-badge tp-badge--warning' }, 'Rumour');
  return null;
}

async function renderLiveDossier() {
  let meta;
  try {
    meta = await api('');
  } catch {
    return; // no sample universe — keep the static mock-up
  }
  const q = `view=${dossierView}`;
  const [region] = await api(`/entities?type=community&q=Kabuki&${q}`);
  if (!region) return;
  const [parent, control, npcs, events] = await Promise.all([
    region.data.parent ? api(`/entities/${region.data.parent}?${q}`).catch(() => null) : null,
    api(`/entities/${region.id}/relations?kind=controls&${q}`),
    api(`/entities?type=individual&${q}`),
    api(`/entities?type=event&sort=created&limit=4&${q}`),
  ]);
  const session = meta.active_session ? await api(`/entities/${meta.active_session}?${q}`).catch(() => null) : null;

  document.getElementById('dossier-view').hidden = false;
  document.getElementById('dossier-source').textContent = `LIVE // ${meta.name.toUpperCase()} // ${meta.clockLabel}`;
  document.getElementById('dossier-name').textContent = parent ? `${parent.name} / ${region.name}` : region.name;
  document.getElementById('dossier-id').textContent = `ID ${region.id.toUpperCase()}`;
  document.getElementById('dossier-summary').textContent = region.data.summary ?? region.data.rumor ?? '';
  const pop = region.data.population;
  document.getElementById('stat-population').textContent = pop == null ? '—' : pop >= 1000 ? `${(pop / 1000).toFixed(1)}K` : pop;
  document.getElementById('stat-threat').textContent = region.data.threat ? `${region.data.threat} / 5` : '—';
  document.getElementById('stat-bribe').textContent = region.data.bribe ?? '—';
  document.getElementById('stat-session').textContent = session?.data.number ? `#${session.data.number}` : '—';

  document.getElementById('dossier-influence').replaceChildren(
    ...control.flatMap((rel, i) => {
      const pct = Math.round((rel.data.value ?? 0) * 100);
      return [
        el('span', {}, rel.fromName ?? '—'),
        el('div', { class: `tp-meter ${METER_TONES[i % METER_TONES.length]}`.trim(), style: `--value:${rel.data.value ?? 0}`, role: 'meter', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }),
        el('span', { class: 'tp-mono' }, `${String(pct).padStart(2, '0')}%`),
      ];
    }),
  );

  const ranked = [...npcs].sort((a, b) => (b.data.tier ?? 0) - (a.data.tier ?? 0));
  document.getElementById('dossier-npc-count').textContent = `${npcs.length} TRACKED`;
  document.getElementById('dossier-npcs').replaceChildren(
    ...ranked.map((npc) =>
      el('tr', {},
        el('td', {}, npc.name, ' ', visibilityBadge(npc)),
        el('td', { class: 'tp-muted' }, npc.data.role ?? (npc.visibility === 'rumored' ? '???' : '—')),
        el('td', {}, npc.data.tier ? el('span', { class: 'tp-badge', 'data-tier': npc.data.tier }, TIER_NAMES[npc.data.tier - 1]) : null),
      ),
    ),
  );

  document.getElementById('dossier-log').replaceChildren(
    ...events.map((ev) =>
      el('li', {},
        el('time', {}, clockTime(ev.createdAt, meta.calendar)),
        el('span', {}, ev.name, ' ', (ev.data.severity ?? 0) >= 4 ? el('span', { class: 'tp-badge tp-badge--warning' }, 'Escalating') : null),
      ),
    ),
  );
}

document.getElementById('dossier-view').addEventListener('click', (e) => {
  const tab = e.target.closest('.tp-tab');
  if (!tab) return;
  dossierView = tab.dataset.view;
  e.currentTarget.querySelectorAll('.tp-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  renderLiveDossier();
});

renderLiveDossier();

// Start with Windows
const autoEnabled = document.getElementById('autostart-enabled');
const autoMode = document.getElementById('autostart-mode');
const autoState = document.getElementById('autostart-state');

function renderAutostart({ enabled, mode }) {
  autoEnabled.checked = enabled;
  autoMode.disabled = !enabled;
  if (mode) autoMode.value = mode;
  autoState.textContent = enabled ? `ENABLED // ${mode.toUpperCase()}` : 'DISABLED';
}

async function saveAutostart() {
  autoEnabled.disabled = autoMode.disabled = true;
  try {
    const res = await fetch('/api/system/autostart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: autoEnabled.checked, mode: autoMode.value }),
    });
    if (!res.ok) throw new Error(res.status);
    renderAutostart(await res.json());
  } catch {
    document.getElementById('autostart-note').textContent = 'Could not update the Startup shortcut — check the server log.';
  } finally {
    autoEnabled.disabled = false;
    autoMode.disabled = !autoEnabled.checked;
  }
}

autoEnabled.addEventListener('change', saveAutostart);
autoMode.addEventListener('change', saveAutostart);
fetch('/api/system/autostart')
  .then((r) => r.json())
  .then(renderAutostart)
  .catch(() => (autoState.textContent = 'UNAVAILABLE'));

engine.init().catch((err) => {
  console.error(err);
  const badge = document.getElementById('status-badge');
  badge.className = 'tp-badge tp-badge--danger';
  badge.textContent = 'Theme load failed';
});

window.tempestThemes = engine; // handy from devtools
