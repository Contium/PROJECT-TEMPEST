// Thin client for the TEMPEST HTTP API. Everything the user makes belongs to a
// project: setProject() picks which one, and every call below goes to it.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.problems = body?.problems ?? [];
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  // Every write sends JSON: the server rejects anything else as a CSRF guard.
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/api${path}`, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// --- projects ------------------------------------------------------------------------

let projectId = null;

/** Point every project-scoped call (presets, characters, images) at a project. */
export function setProject(id) {
  projectId = id;
}
export const currentProjectId = () => projectId;

/** The current project's API path prefix. */
function scoped(path) {
  if (!projectId) throw new ApiError(409, { error: 'Choose a project first' });
  return `/projects/${encodeURIComponent(projectId)}${path}`;
}

export const projects = {
  list: () => api('/projects'),
  create: (input) => api('/projects', { method: 'POST', body: input }),
  /** One project; open marks it as just opened (it sorts first). */
  get: (id, { open = false } = {}) => api(`/projects/${encodeURIComponent(id)}${open ? '?open=1' : ''}`),
  update: (id, patch) => api(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  remove: (id) => api(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// --- the current project's data ---------------------------------------------------------

/** Entities of one kind ('characters', 'stories'): list (by category), get, create, save, remove. */
export function entitiesApi(kind) {
  const base = () => scoped(`/${encodeURIComponent(kind)}`);
  const one = (id) => `${base()}/${encodeURIComponent(id)}`;
  return {
    list: (category) => api(`${base()}${category ? `?category=${encodeURIComponent(category)}` : ''}`),
    get: (id) => api(one(id)),
    create: (entity) => api(base(), { method: 'POST', body: entity }),
    save: (entity) => api(one(entity.id), { method: 'PUT', body: entity }),
    remove: (id) => api(one(id), { method: 'DELETE' }),
  };
}
export const characters = entitiesApi('characters');
export const stories = entitiesApi('stories');
export const items = entitiesApi('items');
/** Every entity of every kind in the project, as summaries: for links that can point at anything. */
export const allEntities = () => api(scoped('/entities'));

/** Points of interest on the World View globe; list({ view: 'player' }) gives only revealed ones. */
export const pois = {
  list: ({ view } = {}) => api(scoped(`/pois${view === 'player' ? '?view=player' : ''}`)),
  create: (poi) => api(scoped('/pois'), { method: 'POST', body: poi }),
  save: (poi) => api(scoped(`/pois/${encodeURIComponent(poi.id)}`), { method: 'PUT', body: poi }),
  remove: (id) => api(scoped(`/pois/${encodeURIComponent(id)}`), { method: 'DELETE' }),
};

/** Points of interest on a City Map (city: 'nightcity'); players get revealed ones, without references. */
export const cityPois = {
  list: (city, { view } = {}) => api(scoped(`/citypois?city=${encodeURIComponent(city)}${view === 'player' ? '&view=player' : ''}`)),
  create: (poi) => api(scoped('/citypois'), { method: 'POST', body: poi }),
  save: (poi) => api(scoped(`/citypois/${encodeURIComponent(poi.id)}`), { method: 'PUT', body: poi }),
  remove: (id) => api(scoped(`/citypois/${encodeURIComponent(id)}`), { method: 'DELETE' }),
};

/**
 * Places of the Planar, Cartographer and Galactic map systems, by kind: 'planes', 'ways',
 * 'charts', 'pins', 'regions', 'stars', 'lanes', 'sectors'. list({ chart }) narrows pins and
 * regions to one chart. Deleting a plane, system or chart takes its ways, lanes, pins and regions too.
 * The star map's list includes its unique places (Night City); saving one moves or reveals it.
 */
export function placesApi(kind) {
  const base = () => scoped(`/${kind}`);
  return {
    list: ({ chart } = {}) => api(`${base()}${chart ? `?chart=${encodeURIComponent(chart)}` : ''}`),
    create: (x) => api(base(), { method: 'POST', body: x }),
    save: (x) => api(`${base()}/${encodeURIComponent(x.id)}`, { method: 'PUT', body: x }),
    remove: (id) => api(`${base()}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

/** The player screen: what's on it, and pushing to it (see app/push/push-model.js). */
export const display = {
  get: () => api('/display'),
  push: (request) => api('/display', { method: 'PUT', body: request }),
};

/** NET architectures (Combat › Netrunning): list, get, create, save, remove. */
export const networks = {
  list: () => api(scoped('/networks')),
  get: (id) => api(scoped(`/networks/${encodeURIComponent(id)}`)),
  create: (net) => api(scoped('/networks'), { method: 'POST', body: net }),
  save: (net) => api(scoped(`/networks/${encodeURIComponent(net.id)}`), { method: 'PUT', body: net }),
  remove: (id) => api(scoped(`/networks/${encodeURIComponent(id)}`), { method: 'DELETE' }),
};

/** World › Timeline as the players get it: what's in their Codex, dated, as each sheet allows. */
export const playerTimeline = () => api(scoped('/timeline'));

/** The Initiative Tracker's encounter (Combat › Initiative): get it, or apply an action ({ action, … }). */
export const encounter = {
  get: () => api(scoped('/encounter')),
  act: (action) => api(scoped('/encounter'), { method: 'POST', body: action }),
};

/** Screamsheets (World › Screamsheets): list (newest first), get, create, save, remove. */
export const screamsheets = {
  list: () => api(scoped('/screamsheets')).then((list) => list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))),
  get: (id) => api(scoped(`/screamsheets/${encodeURIComponent(id)}`)),
  create: (sheet) => api(scoped('/screamsheets'), { method: 'POST', body: sheet }),
  save: (sheet) => api(scoped(`/screamsheets/${encodeURIComponent(sheet.id)}`), { method: 'PUT', body: sheet }),
  remove: (id) => api(scoped(`/screamsheets/${encodeURIComponent(id)}`), { method: 'DELETE' }),
};

/** A project's simple collection (/sessions, /handouts): list, get, create, save, remove. */
const collection = (route) => ({
  list: () => api(scoped(route)),
  get: (id) => api(scoped(`${route}/${encodeURIComponent(id)}`)),
  create: (x) => api(scoped(route), { method: 'POST', body: x }),
  save: (x) => api(scoped(`${route}/${encodeURIComponent(x.id)}`), { method: 'PUT', body: x }),
  remove: (id) => api(scoped(`${route}/${encodeURIComponent(id)}`), { method: 'DELETE' }),
});
/** Sessions › Session log and Handouts (app/sessions/session-model.js). */
export const sessions = collection('/sessions');
export const handouts = collection('/handouts');

/** Screamsheet Generator table packs, imported from the GM's own PDF (shared by every project). */
export const packs = {
  list: () => api('/packs/screamsheet'),
  sources: () => api('/packs/screamsheet/sources'),
  import: (path) => api('/packs/screamsheet/import', { method: 'POST', body: { path } }),
};

/** Sharing the player screen on the local network (server/lan.js); applies to every project. */
export const lan = {
  status: () => api('/lan'),
  setEnabled: (enabled) => api('/lan', { method: 'PUT', body: { enabled } }),
  newLink: () => api('/lan/new-link', { method: 'POST' }),
};

/** The GM window on the local network (server/gm-lan.js): this PC's own window only. */
export const gmLan = {
  status: () => api('/gm-lan'),
  setEnabled: (enabled) => api('/gm-lan', { method: 'PUT', body: { enabled } }),
  newKey: () => api('/gm-lan/new-key', { method: 'POST' }),
};

/** Who's asking: { role: 'gm' | 'player', remote } (remote: a device paired through GM on your network). */
export const role = () => api('/role');

export const imageUrl = (id) => `/api${scoped(`/assets/${encodeURIComponent(id)}`)}`;

const MAX_EDGE = 1600;

/**
 * Upload an image File/Blob; resolves to { id, mime, size }. Large photos are
 * scaled to 1600px on their long edge (or `maxEdge`: maps keep more detail) and
 * re-encoded as WebP first; GIFs (which may be animated) and small images go up untouched.
 */
export async function uploadImage(file, { maxEdge = MAX_EDGE } = {}) {
  let blob = file;
  if (file.type !== 'image/gif') {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      if (scale < 1 || file.size > 1.5 * 1024 * 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = (await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.88))) ?? file;
      }
      bitmap.close?.();
    } catch {
      /* not decodable here: let the server judge it */
    }
  }
  const res = await fetch(`/api${scoped('/assets')}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/png' }, body: blob });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Presets of one kind ('characters'): list, get, create/import, save, remove. */
export function presetsApi(kind) {
  const base = () => scoped(`/presets/${encodeURIComponent(kind)}`);
  const one = (id) => `${base()}/${encodeURIComponent(id)}`;
  return {
    list: () => api(base()),
    get: (id) => api(one(id)),
    create: (preset) => api(base(), { method: 'POST', body: preset }),
    save: (preset) => api(one(preset.id), { method: 'PUT', body: preset }),
    remove: (id) => api(one(id), { method: 'DELETE' }),
  };
}
