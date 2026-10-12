// Thin, cached, traced client for the Qloo hackathon API.
// The key never leaves the server. Every call is recorded (without the key)
// so the UI can show exactly which Qloo evidence backs each recommendation.

const BASE = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';
const KEY = process.env.QLOO_API_KEY || '';

const cache = new Map(); // warm-instance cache; Qloo allows private server-side caching
const CACHE_MAX = 2000;

export class QlooError extends Error {
  constructor(status, message, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

export function qlooConfigured() {
  return Boolean(KEY);
}

/**
 * GET a Qloo endpoint.
 * @param {string} path e.g. '/v2/insights'
 * @param {Record<string, string|number|boolean|string[]>} params
 * @param {{trace?: Function, label?: string}} opts
 */
export async function qget(path, params = {}, opts = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const url = `${BASE}${path}?${qs.toString()}`;
  const started = Date.now();
  const cached = cache.get(url);
  if (cached) {
    opts.trace?.({ path, params, ms: 0, cached: true, label: opts.label, count: countResults(cached) });
    return cached;
  }
  if (!KEY) throw new QlooError(503, 'Qloo API key not configured on the server', path);

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { headers: { 'X-Api-Key': KEY, accept: 'application/json' } });
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2));
  }
  const ms = Date.now() - started;
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `Qloo ${res.status}`;
    opts.trace?.({ path, params, ms, error: msg, status: res.status, label: opts.label });
    throw new QlooError(res.status, msg, path);
  }
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(url, body);
  opts.trace?.({ path, params, ms, cached: false, label: opts.label, count: countResults(body) });
  return body;
}

function countResults(body) {
  const r = body?.results;
  if (!r) return 0;
  if (Array.isArray(r)) return r.length;
  for (const k of ['entities', 'heatmap', 'tags', 'audiences', 'demographics']) {
    if (Array.isArray(r[k])) return r[k].length;
  }
  return 0;
}

// ---------- typed helpers ----------

export const insights = (params, opts) => qget('/v2/insights', params, opts);

export async function searchEntities(query, types, opts) {
  const body = await qget('/search', { query, types, take: 5 }, opts);
  return (body?.results || []).map(slimEntity);
}

export async function searchTags(query, opts, extra = {}) {
  const body = await qget('/v2/tags', { 'filter.query': query, take: 10, ...extra }, opts);
  return (body?.results?.tags || body?.results || []).map((t) => ({
    id: t.id || t.tag_id,
    name: t.name,
    type: t.type || t.subtype,
  }));
}

export function entitiesOf(body) {
  return (body?.results?.entities || []).map(slimEntity);
}

export function slimEntity(e) {
  if (!e) return e;
  const p = e.properties || {};
  const geo = p.geocode || {};
  return {
    id: e.entity_id || e.id,
    name: e.name,
    type: e.subtype || e.type,
    affinity: e.query?.affinity ?? e.affinity,
    popularity: e.popularity,
    image: p.image?.url,
    description: p.short_description || p.description,
    address: p.address,
    city: geo.city || geo.name,
    country: geo.country_code,
    lat: e.location?.lat ?? p.geocode?.latitude,
    lng: e.location?.lon ?? e.location?.lng ?? p.geocode?.longitude,
    tags: (e.tags || []).slice(0, 6).map((t) => t.name),
    explain: e.query?.explainability,
  };
}
