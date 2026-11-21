// Local AI categorizer using Ollama (https://ollama.com), which runs models on this PC. Nothing leaves the machine.

const { SYSTEM, SCHEMA } = require('./claude');

const HOST = 'http://127.0.0.1:11434';
const BATCH_SIZE = 25; // small local models stay accurate with shorter lists

async function status(model) {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const has = models.some(n => n === model || n === `${model}:latest` || n.split(':')[0] === model);
    return { running: true, models, hasModel: has };
  } catch {
    return { running: false, models: [], hasModel: false };
  }
}

// Older graphics cards (or old drivers) can crash Ollama's GPU runner. When that happens we
// switch to CPU-only: slower, but it works. The app remembers it in settings (`ollamaCpuOnly`).
let cpuOnly = false;
let onCpuFallback = () => {};

function looksLikeGpuCrash(status, text) {
  return status === 500 && /llama-server process has terminated|CUDA|cuda|0xc0000409|ggml|vulkan|rocm/i.test(text);
}

async function chat(model, messages, signal) {
  return fetch(`${HOST}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: SCHEMA,
      options: cpuOnly ? { temperature: 0, num_gpu: 0 } : { temperature: 0 },
      messages,
    }),
  });
}

async function categorizeBatch(model, batch, knownCategories, signal) {
  const lines = batch.map(b => JSON.stringify({ id: b.id, title: b.title, url: b.url, folder: b.folder }));
  const prompt =
    (knownCategories.length ? `Categories already in use: ${knownCategories.join(', ')}\n\n` : '') +
    `Bookmarks (one JSON object per line):\n${lines.join('\n')}`;
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];

  let res = await chat(model, messages, signal);
  if (!res.ok && !cpuOnly) {
    const text = await res.clone().text().catch(() => '');
    if (looksLikeGpuCrash(res.status, text)) {
      cpuOnly = true;
      onCpuFallback();
      res = await chat(model, messages, signal);
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) throw new Error(`Ollama doesn't have the model "${model}" yet. Run: ollama pull ${model}`);
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  let parsed;
  try { parsed = JSON.parse(data.message.content); } catch { return []; } // skip a garbled batch rather than stop everything
  const valid = new Set(batch.map(b => b.id));
  return (parsed.items || [])
    .filter(r => valid.has(r.id) && typeof r.category === 'string' && r.category.trim())
    .map(r => ({ id: r.id, category: r.category.trim().slice(0, 40), tags: (r.tags || []).map(String).slice(0, 4) }));
}

// `cpu`: start on the CPU (remembered from an earlier GPU crash, or set in Settings).
// `onFallback`: called once if the GPU crashes during this run and we switch to the CPU.
async function categorize({ model, bookmarks, knownCategories, onBatch, signal, cpu = false, onFallback }) {
  cpuOnly = !!cpu;
  onCpuFallback = onFallback || (() => {});
  const s = await status(model);
  if (!s.running) throw new Error('Ollama is not running. Install it from ollama.com, or start the Ollama app.');
  if (!s.hasModel) throw new Error(`Ollama doesn't have the model "${model}" yet. In a terminal, run: ollama pull ${model}`);
  const categories = new Set(knownCategories);
  let done = 0;
  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    if (signal?.aborted) return;
    const batch = bookmarks.slice(i, i + BATCH_SIZE);
    const results = await categorizeBatch(model, batch, [...categories].sort(), signal);
    results.forEach(r => categories.add(r.category));
    done += batch.length;
    onBatch(results, done, bookmarks.length);
  }
}

module.exports = { categorize, status };
