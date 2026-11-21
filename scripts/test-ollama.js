// Checks the Ollama CPU fallback with a fake Ollama (no real Ollama needed).
const assert = require('assert');
const ollama = require('../src/ollama');

const calls = [];
global.fetch = async (url, opts = {}) => {
  const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  if (url.endsWith('/api/tags')) return json(200, { models: [{ name: 'test-model:latest' }] });
  const body = JSON.parse(opts.body);
  const cpu = body.options.num_gpu === 0;
  calls.push(cpu ? 'cpu' : 'gpu');
  // The "graphics card" always crashes, like the GTX 980 did.
  if (!cpu) return json(500, '{"error":"llama-server process has terminated: exit status 0xc0000409: CUDA error"}');
  const ids = JSON.parse('[' + body.messages[1].content.split('\n').filter(l => l.startsWith('{')).join(',') + ']').map(b => b.id);
  return json(200, { message: { content: JSON.stringify({ items: ids.map(id => ({ id, category: 'Test', tags: [] })) }) } });
};

(async () => {
  const bookmarks = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `t${i}`, url: `https://x${i}.example/`, folder: '' }));
  let fallbacks = 0, got = 0;
  const run = (cpu) => ollama.categorize({ model: 'test-model', bookmarks, knownCategories: [], cpu,
    onBatch: (r) => { got += r.length; }, onFallback: () => fallbacks++ });

  await run(false);
  assert.deepStrictEqual(calls, ['gpu', 'cpu', 'cpu'], 'tries the GPU once, then stays on the CPU');
  assert.strictEqual(fallbacks, 1, 'reports the switch once');
  assert.strictEqual(got, 30);

  calls.length = 0; fallbacks = 0; got = 0;
  await run(true); // next run, with the remembered setting
  assert.deepStrictEqual(calls, ['cpu', 'cpu'], 'remembered: never touches the GPU');
  assert.strictEqual(fallbacks, 0);
  assert.strictEqual(got, 30);
  console.log('Ollama CPU fallback: switches once, is reported, and the remembered setting skips the GPU. OK');
})().catch(e => { console.error(e); process.exit(1); });
