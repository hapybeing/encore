// POST /api/plan  -> Server-Sent Events stream of the agent's work, ending with the plan.
import { runAgent } from './_lib/agent.js';
import { qlooConfigured } from './_lib/qloo.js';
import { geminiConfigured } from './_lib/gemini.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { artist, region, stops, startCity } = req.body || {};
  if (!artist || typeof artist !== 'string' || artist.length > 120) return res.status(400).json({ error: 'artist is required' });
  if (!qlooConfigured() || !geminiConfigured()) return res.status(503).json({ error: 'Server is missing an API key' });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const emit = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 10000);
  try {
    emit({ type: 'start', artist });
    const out = await runAgent({ artist: artist.trim(), region, stops, startCity }, emit);
    emit({ type: 'plan', ...out });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  } finally {
    clearInterval(ping);
    emit({ type: 'done' });
    res.end();
  }
}
