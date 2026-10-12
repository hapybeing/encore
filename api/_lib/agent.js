import { generate } from './gemini.js';
import { TOOLS, declarations } from './tools.js';
import { REGIONS, routeStops } from './cities.js';

const MAX_STEPS = 16;

export const SYSTEM = `You are Encore, a tour-routing agent for independent musicians and the people who book them.
You plan profitable, fan-dense tours by reasoning over Qloo's taste graph, never over your own assumptions.

Method (use the tools, in roughly this order; batch independent calls in one turn):
1. resolve_artist. If nothing is found, say so and stop with submit_tour_plan explaining it.
2. rank_markets for the requested region, and audience_profile, and taste_neighbors.
3. Pick the requested number of stops from the top of rank_markets. You may skip a high-ranked city only for routing reasons; you must NOT add a city the data ranks low just because it is famous. Name famous cities that ranked low in "skip".
4. For each chosen city call find_venues and local_openers (and neighbourhood_hotspots for the top 3 cities).
5. submit_tour_plan. Each stop: the city, why (quote its market score and rank), the best-matching venue by Qloo affinity, a local opener from local_openers (prefer lower popularity = emerging local act; never the headliner), and a concrete promo line combining hotspots + audience_profile (e.g. a brand to partner with, a show/podcast to advertise on).

Rules: every name you output must appear in a tool result. Affinity is an aggregate audience signal, not a prediction about any individual. Be concise and concrete. Do not ask the user questions.`;

export async function runAgent({ artist, region = 'us', stops = 6, startCity }, emit) {
  const state = {};
  const trace = [];
  const ctx = {
    state,
    opts: (label) => ({ label, trace: (t) => { trace.push(t); emit({ type: 'qloo', call: redact(t) }); } }),
  };
  const R = REGIONS[region] ? region : 'us';
  const n = Math.max(3, Math.min(10, Number(stops) || 6));
  const contents = [{
    role: 'user',
    parts: [{ text: `Plan a ${n}-stop tour in ${REGIONS[R].label} (region code "${R}") for the artist: ${artist}.${startCity ? ` Start in or near ${startCity}.` : ''}` }],
  }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await generate({ system: SYSTEM, contents, tools: declarations, temperature: 0.3 });
    if (res.text) emit({ type: 'thought', text: res.text });
    if (!res.calls.length) {
      if (state.plan) break;
      contents.push({ role: 'model', parts: res.parts.length ? res.parts : [{ text: res.text || '...' }] });
      contents.push({ role: 'user', parts: [{ text: 'Continue with the tools; finish with submit_tour_plan.' }] });
      continue;
    }
    contents.push({ role: 'model', parts: res.parts });
    const responses = await Promise.all(res.calls.map(async (call) => {
      const tool = TOOLS[call.name];
      emit({ type: 'tool_call', name: call.name, args: call.args });
      let result;
      try {
        result = tool ? await tool.run(call.args || {}, ctx) : { error: `unknown tool ${call.name}` };
      } catch (e) {
        result = { error: e.message };
      }
      emit({ type: 'tool_result', name: call.name, summary: summarize(call.name, result) });
      if (call.name === 'rank_markets' && state.markets) emit({ type: 'markets', markets: state.markets });
      if (call.name === 'find_venues' && result?.venues) emit({ type: 'venues', city: result.city, venues: result.venues });
      return { functionResponse: { name: call.name, response: { result } } };
    }));
    contents.push({ role: 'user', parts: responses });
    if (state.plan) break;
  }

  if (!state.plan) throw new Error('The agent ran out of steps before finishing a plan.');
  return { plan: enrich(state, R, startCity), trace: trace.map(redact) };
}

function enrich(state, region, startCity) {
  const markets = state.markets || [];
  const rankOf = new Map(markets.map((m, i) => [m.city.toLowerCase(), i + 1]));
  const geo = new Map(REGIONS[region].cities.map(([c, lat, lng]) => [c.toLowerCase(), { lat, lng }]));
  let stops = (state.plan.stops || []).map((s) => {
    const key = s.city.toLowerCase();
    const m = markets.find((x) => x.city.toLowerCase() === key) || {};
    const venues = state.venues?.[s.city] || Object.entries(state.venues || {}).find(([c]) => c.toLowerCase() === key)?.[1] || [];
    const venue = venues.find((v) => v.name === s.venue) || venues[0];
    return {
      ...s,
      ...(geo.get(key) || {}),
      rank: rankOf.get(key),
      score: m.score,
      hotspot_affinity: m.hotspot_affinity,
      scene_size: m.scene_size,
      venue_detail: venue || null,
      venues,
      openers: state.openers?.[s.city] || [],
      hotspots: state.hotspots?.[s.city] || [],
    };
  });
  stops = routeStops(stops.filter((s) => s.lat), startCity).concat(stops.filter((s) => !s.lat));
  return {
    ...state.plan,
    stops,
    artist: state.artist,
    markets,
    neighbors: state.neighbors || [],
    profile: state.profile || {},
    region: REGIONS[region].label,
  };
}

function summarize(name, r) {
  if (r?.error) return `error: ${r.error}`;
  switch (name) {
    case 'resolve_artist': return r.found ? `found ${r.artist.name}` : 'not found';
    case 'taste_neighbors': return `${r.neighbors.length} fan-overlap artists`;
    case 'rank_markets': return `top: ${r.ranked.slice(0, 3).map((x) => x.city).join(', ')}`;
    case 'find_venues': return `${r.venues.length} venues in ${r.city}`;
    case 'local_openers': return `${r.openers.length} openers in ${r.city}`;
    case 'audience_profile': return 'brands, shows, podcasts, films';
    case 'neighbourhood_hotspots': return `${r.hotspots.length} hotspots in ${r.city}`;
    case 'submit_tour_plan': return 'plan submitted';
    default: return 'ok';
  }
}

function redact(t) {
  // never include the key; params only contain public IDs and place names
  return { label: t.label, path: t.path, params: t.params, ms: t.ms, cached: t.cached, count: t.count, error: t.error };
}

export async function runBaseline({ artist, region = 'us', stops = 6 }) {
  const R = REGIONS[region] ? region : 'us';
  const res = await generate({
    system: 'You are a helpful music-industry assistant. Answer from general knowledge only.',
    contents: [{ role: 'user', parts: [{ text: `Plan a ${stops}-stop tour in ${REGIONS[R].label} for the artist ${artist}. Return JSON: {"stops":[{"city":"","venue":"","opener":"","why":""}]}` }] }],
    json: true,
    temperature: 0.4,
  });
  try {
    return JSON.parse(res.text);
  } catch {
    return { stops: [], raw: res.text };
  }
}
