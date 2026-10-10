import test from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetedGeminiProvider, GEMINI_INPUT_BOUND, GEMINI_OUTPUT_BOUND } from '../gemini-provider.mjs';
import { createAiBudgetGate } from '../ai-budget.mjs';
import { createAiCostReservation, calculateAiCostMicros } from '../ai-pricing.mjs';
import { createOptionalAiRuntime } from '../ai-runtime.mjs';
import { crc32c } from '../secret-reader.mjs';
import { memoryDb } from './budget-fixture.mjs';

const config = { model: 'gemini-3.5-flash-lite', apiKeySecret: 'projects/123456789/secrets/fixture-key/versions/1', pricingVersion: 'fixture-not-live-prices', jpyMicrosPerUsd: 150000000, inputUsdMicrosPerMillion: 300000, outputUsdMicrosPerMillion: 2500000, searchUsdMicrosPerQuery: 14000 };
const request = { input: 'Last purchase?', systemInstruction: 'Use only supplied purchase facts.' };
const key = () => Buffer.from('anonymous_fixture_key_1234');
const bound = createAiCostReservation(config, { maxInputTokens: GEMINI_INPUT_BOUND, maxOutputTokens: GEMINI_OUTPUT_BOUND, maxSearchQueries: 0, tokenBoundEvidence: 'fixture' }).upperBoundJpyMicro;
const usage = () => ({ total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 10, total_tokens: 130, total_tool_use_tokens: 0, total_cached_tokens: 0 });
const result = () => ({ model: config.model, status: 'completed', usage: usage(), steps: [{ type: 'thought', signature: 'opaque-fixture-only', summary: [] }, { type: 'model_output', content: [{ type: 'text', text: 'The last purchase was 2026-09-01.' }] }] });
function setup({ limit = 700000000, fetchImpl = async () => new Response(JSON.stringify(result())), readSecret, timeoutMs } = {}) {
  let reads = 0, calls = 0;
  const gate = createAiBudgetGate(memoryDb(), { limitMicros: limit, clock: () => new Date('2026-10-10T00:00:00Z') });
  const call = createBudgetedGeminiProvider({ gate, config, timeoutMs,
    readSecret: readSecret ?? (async ref => { reads++; assert.equal(ref, config.apiKeySecret); return key(); }),
    fetchImpl: async (...args) => { calls++; return fetchImpl(...args); },
  });
  return { gate, call, counts: () => ({ reads, calls }) };
}
test('fixed single transport, hard bound, Secret after claim, no persistence or tools', async () => {
  let bytes;
  const ctx = setup({
    readSecret: async () => { bytes = key(); return bytes; },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
      assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-goog-api-key'], key().toString());
      assert(!url.includes(key().toString()));
      const body = JSON.parse(options.body);
      assert.equal(body.model, config.model); assert.equal(body.store, false); assert.equal(body.stream, false);
      assert.equal(body.generation_config.max_output_tokens, GEMINI_OUTPUT_BOUND);
      assert.equal(body.generation_config.thinking_level, 'minimal');
      assert.equal(body.tools, undefined); assert.equal(body.previous_interaction_id, undefined);
      assert.equal((await ctx.gate.reserve({ operationId: 'first', kind: 'ai', model: config.model, upperBoundJpyMicro: bound, pricingVersion: 'different', hardBoundVerified: true }).catch(() => 'claimed')), 'claimed');
      return new Response(JSON.stringify(result()));
    },
  });
  const answer = await ctx.call(request, { operationId: 'first' });
  assert.equal(answer.allowed, true); assert.equal(answer.value.text, result().steps[1].content[0].text);
  assert(bytes.every(n => n === 0));
  assert.equal(ctx.counts().calls, 1);
});
test('budget denial does not retrieve Secret or dispatch', async () => {
  const ctx = setup({ limit: bound - 1 });
  const answer = await ctx.call(request, { operationId: 'denied' });
  assert.equal(answer.code, 'MONTHLY_BUDGET_EXHAUSTED');
  assert.deepEqual(ctx.counts(), { reads: 0, calls: 0 });
  assert.deepEqual(answer.fallback, { deferImports: true, history: true, replenishment: true, notificationPrice: false });
});
test('provider/model/search/price overrides and oversized input rejected before external access', async () => {
  for (const input of [{ ...request, model: 'other' }, { ...request, tools: [{ type: 'google_search' }] }, { ...request, generation_config: {} }, { input: ' ' }, { input: 'x'.repeat(65536) }, { ...request, upperBoundJpyMicro: 1 }]) {
    const ctx = setup(); assert.equal((await ctx.call(input, { operationId: 'invalid' })).code, 'PROVIDER_PREPARATION_FAILED');
    assert.deepEqual(ctx.counts(), { reads: 0, calls: 0 });
  }
});
test('known usage settles thoughts and undiscounted cached input; incomplete response still settles', async () => {
  let settled;
  const ctx = setup({ fetchImpl: async () => { const body = result(); body.status = 'incomplete'; body.steps = []; body.usage.total_cached_tokens = 90; return new Response(JSON.stringify(body)); } });
  const settle = ctx.gate.settle.bind(ctx.gate);
  ctx.gate.settle = async (id, amount) => { settled = amount; return settle(id, amount); };
  const answer = await ctx.call(request, { operationId: 'partial' });
  assert.equal(answer.allowed, true); assert.deepEqual(answer.value, { status: 'incomplete', text: null });
  assert.equal(settled, calculateAiCostMicros(config, { inputTokens: 100, outputTokens: 30, searchQueries: 0 }));
  assert.equal((await ctx.call(request, { operationId: 'partial' })).allowed, false);
  assert.equal(ctx.counts().calls, 1);
});
test('missing/inconsistent/tool/modality usage retains reservation and never reissues', async () => {
  for (const alter of [
    body => { delete body.usage; },
    body => { delete body.usage.total_thought_tokens; },
    body => { body.usage.total_tokens++; },
    body => { body.usage.total_tool_use_tokens = 1; },
    body => { body.usage.input_tokens_by_modality = [{ modality: 'image', tokens: 1 }]; },
    body => { body.usage.grounding_tool_counts = [{ type: 'google_search', count: 1 }]; },
  ]) {
    const ctx = setup({ limit: bound, fetchImpl: async () => { const body = result(); alter(body); return new Response(JSON.stringify(body)); } });
    const answer = await ctx.call(request, { operationId: 'unknown' });
    assert.equal(answer.code, 'PROVIDER_RESULT_UNKNOWN');
    assert.equal((await ctx.call(request, { operationId: 'unknown' })).allowed, false);
    assert.equal((await ctx.call(request, { operationId: 'new' })).code, 'MONTHLY_BUDGET_EXHAUSTED');
    assert.equal(ctx.counts().calls, 1);
  }
});
test('observed output-bound violation stops future operations without fabricating actual charge', async () => {
  const ctx = setup({ fetchImpl: async () => { const body = result(); body.usage = { ...usage(), total_output_tokens: GEMINI_OUTPUT_BOUND + 1, total_thought_tokens: 0, total_tokens: 100 + GEMINI_OUTPUT_BOUND + 1 }; return new Response(JSON.stringify(body)); } });
  let settled;
  const settle = ctx.gate.settle.bind(ctx.gate);
  ctx.gate.settle = async (id, amount) => { settled = amount; return settle(id, amount); };
  const answer = await ctx.call(request, { operationId: 'violation' });
  assert.equal(answer.value.code, 'PROVIDER_BOUND_VIOLATION');
  assert.equal(settled, calculateAiCostMicros(config, { inputTokens: 100, outputTokens: GEMINI_OUTPUT_BOUND + 1, searchQueries: 0 }));
  assert.equal((await ctx.call(request, { operationId: 'later' })).code, 'COST_OVERRUN');
  assert.equal(ctx.counts().calls, 1);
});
test('transport error/403/redirect/bad JSON redacted and not automatically retried', async () => {
  for (const transport of [
    async () => { throw Error('private-payload-key'); },
    async () => new Response('private-payload-key', { status: 403 }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } }),
    async () => new Response('private-payload-key'),
  ]) {
    const ctx = setup({ fetchImpl: transport });
    const answer = await ctx.call(request, { operationId: 'failed' });
    assert.equal(answer.code, 'PROVIDER_RESULT_UNKNOWN');
    assert(!JSON.stringify(answer).includes('private-payload-key'));
    assert.equal(ctx.counts().calls, 1);
  }
});
test('deadline includes Secret and bounds transports that ignore abort', async () => {
  for (const where of ['secret', 'fetch']) {
    const ctx = setup({ timeoutMs: 5, ...(where === 'secret' ? { readSecret: () => new Promise(() => {}) } : { fetchImpl: () => new Promise(() => {}) }) });
    const keepAlive = setTimeout(() => {}, 100);
    try { assert.equal((await ctx.call(request, { operationId: where })).code, 'PROVIDER_RESULT_UNKNOWN'); }
    finally { clearTimeout(keepAlive); }
    assert.equal(ctx.counts().calls, where === 'secret' ? 0 : 1);
  }
});
test('bounded response body and API key validation fail closed', async () => {
  const huge = setup({ fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)) });
  assert.equal((await huge.call(request, { operationId: 'huge' })).code, 'PROVIDER_RESULT_UNKNOWN');
  const invalid = setup({ readSecret: async () => Buffer.from('invalid\nkey') });
  assert.equal((await invalid.call(request, { operationId: 'key' })).code, 'PROVIDER_RESULT_UNKNOWN');
  assert.equal(invalid.counts().calls, 0);
});
test('runtime is default-off, config errors preserve fallback, enabled runtime connects pinned Secret and Gemini', async () => {
  let calls = 0;
  for (const env of [{}, { AI_RUNTIME_ENABLED: 'true', AI_RUNTIME_CONFIG_JSON: '{invalid' }, { AI_RUNTIME_ENABLED: 'true', AI_RUNTIME_CONFIG_JSON: JSON.stringify({ ...config, model: 'other' }) }]) {
    const runtime = createOptionalAiRuntime({ db: memoryDb(), env, fetchImpl: async () => { calls++; } });
    assert.equal(runtime.enabled, false);
    const answer = await runtime.call(request, { operationId: 'disabled' });
    assert.equal(answer.allowed, false); assert.equal(answer.fallback.history, true);
  }
  assert.equal(calls, 0);
  const paths = [];
  const runtime = createOptionalAiRuntime({ db: memoryDb(), env: { AI_RUNTIME_ENABLED: 'true', AI_RUNTIME_CONFIG_JSON: JSON.stringify(config) },
    credential: { getAccessToken: async () => ({ access_token: 'anonymous-token' }) },
    fetchImpl: async (url, options) => {
      paths.push(url);
      if (url.includes('secretmanager.googleapis.com')) {
        assert.equal(options.headers.Authorization, 'Bearer anonymous-token');
        const bytes = key();
        return new Response(JSON.stringify({ name: config.apiKeySecret, payload: { data: bytes.toString('base64'), dataCrc32c: String(crc32c(bytes)) } }));
      }
      return new Response(JSON.stringify(result()));
    },
  });
  assert.equal(runtime.enabled, true);
  assert.equal(paths.length, 0);
  assert.equal((await runtime.call(request, { operationId: 'runtime' })).allowed, true);
  assert.equal(paths.length, 2);
});
