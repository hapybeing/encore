// Minimal Gemini REST client with function calling (no SDK, no extra deps).
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';

export function geminiConfigured() {
  return Boolean(KEY);
}

export async function generate({ system, contents, tools, toolMode = 'AUTO', temperature = 0.4, json = false }) {
  if (!KEY) throw new Error('Gemini API key not configured on the server');
  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (tools?.length) {
    body.tools = [{ functionDeclarations: tools }];
    body.toolConfig = { functionCallingConfig: { mode: toolMode } };
  }
  let lastErr;
  for (const model of [MODEL, MODEL, FALLBACK]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates?.[0];
      const parts = cand?.content?.parts || [];
      return {
        model,
        parts,
        text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(''),
        calls: parts.filter((p) => p.functionCall).map((p) => p.functionCall),
        finish: cand?.finishReason,
      };
    }
    lastErr = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw lastErr;
}
