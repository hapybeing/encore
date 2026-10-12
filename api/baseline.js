// POST /api/baseline -> what a generic LLM (no Qloo) would plan, for side-by-side comparison.
import { runBaseline } from './_lib/agent.js';
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { artist, region, stops } = req.body || {};
  if (!artist) return res.status(400).json({ error: 'artist is required' });
  try {
    res.status(200).json(await runBaseline({ artist, region, stops }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
