import { qlooConfigured } from './_lib/qloo.js';
import { geminiConfigured } from './_lib/gemini.js';
export default function handler(req, res) {
  res.status(200).json({ ok: true, qloo: qlooConfigured(), llm: geminiConfigured() });
}
