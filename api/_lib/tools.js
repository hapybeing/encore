// Agent tools. Each one is a small, composable Qloo workflow with a JSON-schema
// declaration (Gemini function calling) and an executor that returns compact,
// evidence-bearing results the model can reason over.
import { insights, searchEntities, searchTags, entitiesOf, slimEntity } from './qloo.js';
import { REGIONS } from './cities.js';

const ARTIST = 'urn:entity:artist';
const pool = async (items, n, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; try { out[j] = await fn(items[j], j); } catch (e) { out[j] = { error: e.message }; } }
  }));
  return out;
};
const round = (x, d = 3) => (typeof x === 'number' ? Math.round(x * 10 ** d) / 10 ** d : x);
const tagCache = new Map();
async function tagId(query, ctx, prefer) {
  const k = query + '|' + (prefer || '');
  if (tagCache.has(k)) return tagCache.get(k);
  const tags = await searchTags(query, ctx.opts('find tag: ' + query));
  const pick = tags.find((t) => prefer && t.id?.includes(prefer)) || tags[0];
  tagCache.set(k, pick?.id || null);
  return pick?.id || null;
}

export const TOOLS = {
  resolve_artist: {
    description: 'Find the Qloo entity for an artist or band by name. Always call this first.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async run({ name }, ctx) {
      const hits = await searchEntities(name, ARTIST, ctx.opts(`resolve "${name}"`));
      if (!hits.length) return { found: false };
      const [best, ...alts] = hits;
      ctx.state.artist = best;
      return { found: true, artist: pick(best, ['id', 'name', 'popularity', 'tags', 'description']), alternatives: alts.slice(0, 3).map((a) => a.name) };
    },
  },

  taste_neighbors: {
    description: "Artists whose fans overlap most with this artist's fans (Qloo cross-affinity). Use to understand the scene and to pick tour openers.",
    parameters: { type: 'object', properties: { artist_id: { type: 'string' }, take: { type: 'integer' } }, required: ['artist_id'] },
    async run({ artist_id, take = 10 }, ctx) {
      const body = await insights({ 'filter.type': ARTIST, 'signal.interests.entities': artist_id, take }, ctx.opts('taste neighbours'));
      const list = entitiesOf(body).map((e) => ({ name: e.name, id: e.id, affinity: round(e.affinity), popularity: round(e.popularity) }));
      ctx.state.neighbors = list;
      return { neighbors: list };
    },
  },

  rank_markets: {
    description: "Score candidate tour cities by how strongly this artist's audience concentrates there (Qloo heatmap affinity per city). Returns cities ranked best-first. region is one of us, eu, in.",
    parameters: { type: 'object', properties: { artist_id: { type: 'string' }, region: { type: 'string', enum: Object.keys(REGIONS) } }, required: ['artist_id', 'region'] },
    async run({ artist_id, region }, ctx) {
      const R = REGIONS[region] || REGIONS.us;
      const scored = await pool(R.cities, 6, async ([city, lat, lng]) => {
        const body = await insights({
          'filter.type': 'urn:heatmap',
          'signal.interests.entities': artist_id,
          'filter.location.query': city,
          take: 50,
        }, ctx.opts(`heatmap ${city}`));
        const pts = (body?.results?.heatmap || []).map((p) => p.query || {});
        if (!pts.length) return { city, lat, lng, score: 0, points: 0 };
        const aff = pts.map((q) => q.affinity ?? 0).sort((a, b) => b - a);
        const pop = pts.map((q) => q.popularity ?? 0);
        const top = aff.slice(0, Math.max(3, Math.ceil(aff.length * 0.2)));
        const meanTop = top.reduce((s, x) => s + x, 0) / top.length;
        const meanPop = pop.reduce((s, x) => s + x, 0) / pop.length;
        // demand = how hot the hottest neighbourhoods are, tempered by how big the scene is
        return { city, lat, lng, score: round(0.7 * meanTop + 0.3 * meanPop), hotspot_affinity: round(meanTop), scene_size: round(meanPop), points: pts.length };
      });
      const ranked = scored.filter((s) => s && !s.error).sort((a, b) => b.score - a.score);
      ctx.state.markets = ranked;
      return { region: R.label, ranked: ranked.map((r) => pick(r, ['city', 'score', 'hotspot_affinity', 'scene_size'])) };
    },
  },

  find_venues: {
    description: 'Music venues in a city whose crowd best matches this artist\'s audience (Qloo place affinity). Optionally a capacity hint like "small club" or "theater".',
    parameters: { type: 'object', properties: { artist_id: { type: 'string' }, city: { type: 'string' }, kind: { type: 'string' } }, required: ['artist_id', 'city'] },
    async run({ artist_id, city, kind = 'music venue' }, ctx) {
      const tag = await tagId(kind, ctx, 'place');
      const body = await insights({
        'filter.type': 'urn:entity:place',
        'signal.interests.entities': artist_id,
        'filter.location.query': city,
        'filter.tags': tag || undefined,
        take: 6,
      }, ctx.opts(`venues ${city}`));
      const venues = entitiesOf(body).map((e) => pick({ ...e, affinity: round(e.affinity) }, ['id', 'name', 'affinity', 'address', 'lat', 'lng', 'tags', 'image']));
      (ctx.state.venues ||= {})[city] = venues;
      return { city, venues };
    },
  },

  local_openers: {
    description: 'Artists with a real local following in a city whose fans also overlap with this artist — candidates for opening slots that sell local tickets.',
    parameters: { type: 'object', properties: { artist_id: { type: 'string' }, city: { type: 'string' } }, required: ['artist_id', 'city'] },
    async run({ artist_id, city }, ctx) {
      const body = await insights({
        'filter.type': ARTIST,
        'signal.interests.entities': artist_id,
        'signal.location.query': city,
        'filter.popularity.max': 0.9,
        take: 6,
      }, ctx.opts(`openers ${city}`));
      const list = entitiesOf(body).filter((e) => e.id !== artist_id).map((e) => ({ name: e.name, id: e.id, affinity: round(e.affinity), popularity: round(e.popularity) }));
      (ctx.state.openers ||= {})[city] = list;
      return { city, openers: list };
    },
  },

  audience_profile: {
    description: "Cross-domain taste of this artist's audience: the brands, TV shows, podcasts and movies they over-index on. Use for promo targeting, sponsors and merch.",
    parameters: { type: 'object', properties: { artist_id: { type: 'string' } }, required: ['artist_id'] },
    async run({ artist_id }, ctx) {
      const domains = [['brands', 'urn:entity:brand'], ['tv_shows', 'urn:entity:tv_show'], ['podcasts', 'urn:entity:podcast'], ['movies', 'urn:entity:movie']];
      const res = await pool(domains, 4, async ([k, type]) => {
        const body = await insights({ 'filter.type': type, 'signal.interests.entities': artist_id, take: 6 }, ctx.opts(`audience ${k}`));
        return [k, entitiesOf(body).map((e) => ({ name: e.name, affinity: round(e.affinity) }))];
      });
      const profile = Object.fromEntries(res.filter(Array.isArray));
      try {
        const demo = await insights({ 'filter.type': 'urn:demographics', 'signal.interests.entities': artist_id }, ctx.opts('audience demographics'));
        profile.demographics = demo?.results?.demographics?.[0]?.query || null;
      } catch { /* optional */ }
      ctx.state.profile = profile;
      return profile;
    },
  },

  neighbourhood_hotspots: {
    description: "Where inside a city this artist's audience concentrates (Qloo heatmap). Use to pick where to poster, place ads, or host a pop-up.",
    parameters: { type: 'object', properties: { artist_id: { type: 'string' }, city: { type: 'string' } }, required: ['artist_id', 'city'] },
    async run({ artist_id, city }, ctx) {
      const body = await insights({
        'filter.type': 'urn:heatmap',
        'signal.interests.entities': artist_id,
        'filter.location.query': city,
        'output.heatmap.boundary': 'neighborhood',
        take: 8,
      }, ctx.opts(`hotspots ${city}`));
      const pts = (body?.results?.heatmap || [])
        .map((p) => ({ name: p.location?.name || p.name || p.location?.geohash, lat: p.location?.latitude, lng: p.location?.longitude, affinity: round(p.query?.affinity) }))
        .sort((a, b) => b.affinity - a.affinity)
        .slice(0, 5);
      (ctx.state.hotspots ||= {})[city] = pts;
      return { city, hotspots: pts };
    },
  },

  submit_tour_plan: {
    description: 'Submit the final tour plan. Call exactly once, at the end. Every claim must come from tool results.',
    parameters: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One-sentence summary of the tour strategy.' },
        audience_summary: { type: 'string', description: 'Who the fans are, in 2 sentences, grounded in audience_profile.' },
        stops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              why: { type: 'string', description: 'Evidence-based reason, cite the market score.' },
              venue: { type: 'string' },
              opener: { type: 'string' },
              promo: { type: 'string', description: 'Where/how to promote locally (neighbourhood, partner brand, show to advertise on).' },
            },
            required: ['city', 'why', 'venue'],
          },
        },
        skip: { type: 'array', items: { type: 'string' }, description: 'Big-name cities the data says to skip, with a short reason each.' },
        sponsors: { type: 'array', items: { type: 'string' } },
        caveats: { type: 'string' },
      },
      required: ['headline', 'stops'],
    },
    async run(plan, ctx) {
      ctx.state.plan = plan;
      return { ok: true };
    },
  },
};

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) r[k] = o[k];
  return r;
}

export const declarations = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, parameters: t.parameters }));
export { slimEntity };
