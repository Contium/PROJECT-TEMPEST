// Thin client for the TEMPEST HTTP API.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.details = body?.details ?? [];
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  // Every write sends JSON — the server rejects anything else as a CSRF guard.
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/api${path}`, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

function qs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}

export const universes = {
  list: () => api('/universes'),
  create: (body) => api('/universes', { method: 'POST', body }),
};

export function universeApi(uid) {
  const base = `/universes/${encodeURIComponent(uid)}`;
  const entity = (id) => `${base}/entities/${encodeURIComponent(id)}`;
  return {
    meta: () => api(base),
    setMeta: (patch) => api(base, { method: 'PATCH', body: patch }),
    types: () => api(`${base}/types`),
    defineType: (def) => api(`${base}/types`, { method: 'POST', body: def }),
    eras: () => api(`${base}/eras`),
    list: (params) => api(`${base}/entities${qs(params)}`),
    get: (id, params) => api(`${entity(id)}${qs(params)}`),
    history: (id) => api(`${entity(id)}/history`),
    relations: (id, params) => api(`${entity(id)}/relations${qs(params)}`),
    batch: (body) => api(`${base}/batches`, { method: 'POST', body }),
    undo: (batch) => api(`${base}/batches/${encodeURIComponent(batch)}/undo`, { method: 'POST' }),
    redo: (batch) => api(`${base}/batches/${encodeURIComponent(batch)}/redo`, { method: 'POST' }),
    timeline: (params) => api(`${base}/timeline${qs(params)}`),
    clock: (body) => api(`${base}/clock`, { method: 'POST', body }),
    display: () => api(`${base}/display`),
    push: (view) => api(`${base}/display`, { method: 'PUT', body: view }),
    encounter: (params) => api(`${base}/encounter${qs(params)}`),
    /** One Initiative Tracker action ({ action: 'next' }, { action: 'hp', id, delta }…); resolves to the new state. */
    encounterAct: (action) => api(`${base}/encounter`, { method: 'POST', body: action }),
    /** Upload an image Blob (PNG/JPEG/GIF/WebP); resolves to { id, mime, size }. */
    async uploadImage(blob) {
      const res = await fetch(`/api${base}/assets`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data);
      return data;
    },
    imageUrl: (id) => `/api${base}/assets/${encodeURIComponent(id)}`,
    streamUrl: `/api${base}/stream`,
  };
}
