// Auto-categorizing with Claude: sends title + URL + original folder, gets back a category and tags.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const BATCH_SIZE = 80;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'category', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const SYSTEM = `You organize a person's browser bookmarks into a personal library.
For each bookmark, choose one category and 1-4 tags.

Categories:
- Short, Title Case, 1-3 words (e.g. "Development", "Cooking", "Home & Garden", "News").
- The whole library should end up with roughly 12-25 categories, so reuse an existing category whenever one fits instead of inventing a near-duplicate.
- The bookmark's original folder is a strong hint about what the person meant, but fix it when it is clearly a catch-all like "Other bookmarks".

Tags: lowercase, specific, 1-2 words each (e.g. "python", "recipes", "3d printing"). Do not repeat the category as a tag.

Return every id you were given, exactly once.`;

function makeClient(apiKey) {
  // With no saved key, the SDK falls back to ANTHROPIC_API_KEY or an `ant auth login` profile.
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

async function categorizeBatch(client, batch, knownCategories, signal) {
  const lines = batch.map(b => JSON.stringify({ id: b.id, title: b.title, url: b.url, folder: b.folder }));
  const prompt =
    (knownCategories.length ? `Categories already in use: ${knownCategories.join(', ')}\n\n` : '') +
    `Bookmarks (one JSON object per line):\n${lines.join('\n')}`;

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  }, { signal });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined this batch.');
  if (response.stop_reason === 'max_tokens') throw new Error('Response was cut off (batch too large).');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text);
  const valid = new Set(batch.map(b => b.id));
  return parsed.items
    .filter(r => valid.has(r.id) && r.category)
    .map(r => ({ id: r.id, category: r.category.trim(), tags: (r.tags || []).slice(0, 4) }));
}

function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key does not have access to that model.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute and try again.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status}: ${e.message}`;
  if (e && /api key|apiKey|authentication/i.test(e.message || '')) return 'No API key found. Add one in Settings.';
  return e && e.message ? e.message : String(e);
}

// bookmarks: [{id,title,url,folder}]; onBatch(results, done, total) is called after each batch.
async function categorize({ apiKey, bookmarks, knownCategories, onBatch, signal }) {
  const client = makeClient(apiKey);
  const categories = new Set(knownCategories);
  let done = 0;
  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    if (signal?.aborted) return;
    const batch = bookmarks.slice(i, i + BATCH_SIZE);
    const results = await categorizeBatch(client, batch, [...categories].sort(), signal);
    results.forEach(r => categories.add(r.category));
    done += batch.length;
    onBatch(results, done, bookmarks.length);
  }
}

module.exports = { categorize, describeError, MODEL, SYSTEM, SCHEMA };
