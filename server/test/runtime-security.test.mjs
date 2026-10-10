import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedSecretReader, crc32c } from '../secret-reader.mjs';
import { calculateAiCostMicros, createAiCostReservation } from '../ai-pricing.mjs';
import { createAiBudgetGate } from '../ai-budget.mjs';
import { createBudgetedProvider } from '../budgeted-provider.mjs';
import { memoryDb } from './budget-fixture.mjs';

const reference = 'projects/123456789/secrets/anonymous-key/versions/1';
const secret = Buffer.from('anonymous-fixture-only');
const payload = () => ({ name: reference, payload: { data: secret.toString('base64'), dataCrc32c: String(crc32c(secret)) } });
const credential = { getAccessToken: async () => ({ access_token: 'anonymous-fixture-token' }) };
const config = { model: 'gemini-3.5-flash-lite', apiKeySecret: reference, pricingVersion: 'anonymous-pricing-fixture', jpyMicrosPerUsd: 150000000, inputUsdMicrosPerMillion: 300000, outputUsdMicrosPerMillion: 2500000, searchUsdMicrosPerQuery: 14000 };
const bounds = { maxInputTokens: 1000, maxOutputTokens: 2000, maxSearchQueries: 0, tokenBoundEvidence: 'anonymous-fixture-including-thinking' };

test('pinned allowlist, CRC32C known vector, fixed transport and no construction call', async () => {
  assert.equal(crc32c(Buffer.from('123456789')), 0xe3069283);
  let calls = 0;
  const read = createPinnedSecretReader({ allowedReferences: [reference], credential, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, `https://secretmanager.googleapis.com/v1/${reference}:access`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer anonymous-fixture-token');
    assert(options.signal);
    return new Response(JSON.stringify(payload()));
  } });
  assert.equal(calls, 0);
  assert.deepEqual(await read(reference), secret);
  assert.equal(calls, 1);
  for (const ref of [reference.replace('/1', '/latest'), reference.replace('/1', '/2'), reference.replace('anonymous-key', 'unlisted'), 'https://example.invalid']) await assert.rejects(read(ref), error => error.code === 'SECRET_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('secret response name, base64 and checksum errors fail without payload exposure', async () => {
  const cases = [
    { ...payload(), name: reference.replace('/1', '/2') },
    { ...payload(), payload: { ...payload().payload, dataCrc32c: '0' } },
    { ...payload(), payload: { data: secret.toString('base64') } },
    { ...payload(), payload: { ...payload().payload, data: 'not base64!!' } },
    { ...payload(), payload: { data: '', dataCrc32c: '0' } },
    { ...payload(), payload: { data: Buffer.alloc(65537).toString('base64'), dataCrc32c: '0' } },
  ];
  for (const data of cases) {
    const read = createPinnedSecretReader({ allowedReferences: [reference], credential, fetchImpl: async () => new Response(JSON.stringify(data)) });
    await assert.rejects(read(reference), error => error.code === 'SECRET_UNAVAILABLE' && !error.message.includes(secret.toString()) && !error.cause);
  }
});

test('auth, HTTP, malformed JSON and transport failures are redacted and not retried', async () => {
  for (const fetchImpl of [async () => new Response(secret, { status: 403 }), async () => new Response('not-json'), async () => { throw new Error(secret.toString()); }]) {
    let calls = 0;
    const read = createPinnedSecretReader({ allowedReferences: [reference], credential, fetchImpl: async (...args) => { calls++; return fetchImpl(...args); } });
    await assert.rejects(read(reference), error => error.code === 'SECRET_UNAVAILABLE' && error.message === 'Pinned secret unavailable');
    assert.equal(calls, 1);
  }
  let calls = 0;
  const read = createPinnedSecretReader({ allowedReferences: [reference], credential: { getAccessToken: async () => { throw new Error('credential-secret'); } }, fetchImpl: async () => { calls++; } });
  await assert.rejects(read(reference), error => error.code === 'SECRET_UNAVAILABLE');
  assert.equal(calls, 0);
});

test('abort and fetch deadline stop secret access without exposing tokens', async () => {
  const aborted = new AbortController(); aborted.abort();
  let calls = 0;
  const read = createPinnedSecretReader({ allowedReferences: [reference], credential, timeoutMs: 5, fetchImpl: async (url, options) => {
    calls++;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('fixture token timeout')), { once: true });
      // Keep the test alive: AbortSignal.timeout uses an unref'ed timer.
      const keepAlive = setTimeout(() => reject(new Error('deadline not enforced')), 100);
      options.signal.addEventListener('abort', () => clearTimeout(keepAlive), { once: true });
    });
  } });
  await assert.rejects(read(reference, { signal: aborted.signal }), error => error.code === 'SECRET_UNAVAILABLE');
  assert.equal(calls, 0);
  await assert.rejects(read(reference), error => error.code === 'SECRET_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('integer pricing includes all output and each search query, with conservative rounding', () => {
  assert.equal(calculateAiCostMicros(config, { inputTokens: 1000, outputTokens: 2000, searchQueries: 2 }), 4995000);
  assert.equal(calculateAiCostMicros(config, { inputTokens: 0, outputTokens: 0, searchQueries: 0 }), 0);
  assert.equal(calculateAiCostMicros({ ...config, inputUsdMicrosPerMillion: 1 }, { inputTokens: 1, outputTokens: 0, searchQueries: 0 }), 1);
  assert.equal(calculateAiCostMicros(config, { inputTokens: 0, outputTokens: 0, searchQueries: 1 }), 2100000);
});

test('credential acquisition is included in secret deadline and never starts fetch after expiry', async () => {
  let fetched = false;
  const keepAlive = setTimeout(() => {}, 100);
  try {
    const read = createPinnedSecretReader({ allowedReferences: [reference], timeoutMs: 5,
      credential: { getAccessToken: () => new Promise(() => {}) }, fetchImpl: async () => { fetched = true; },
    });
    await assert.rejects(read(reference), error => error.code === 'SECRET_UNAVAILABLE');
    assert.equal(fetched, false);
  } finally { clearTimeout(keepAlive); }
});

test('missing pricing, unsafe counts, overflow and unknown token/search bounds fail closed', () => {
  for (const inputTokens of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => calculateAiCostMicros(config, { inputTokens, outputTokens: 1, searchQueries: 0 }));
  assert.throws(() => calculateAiCostMicros({ ...config, jpyMicrosPerUsd: undefined }, { inputTokens: 1, outputTokens: 1, searchQueries: 0 }));
  assert.throws(() => calculateAiCostMicros(config, { inputTokens: 1, outputTokens: Number.MAX_SAFE_INTEGER, searchQueries: 0 }));
  for (const patch of [{ tokenBoundEvidence: '' }, { maxInputTokens: 1048577 }, { maxOutputTokens: 65537 }, { maxOutputTokens: 0 }, { maxSearchQueries: 1 }]) assert.throws(() => createAiCostReservation(config, { ...bounds, ...patch }));
});

test('reservation identity changes with rates and evidence; search needs explicit verified maximum', () => {
  const base = createAiCostReservation(config, bounds);
  assert.equal(base.upperBoundJpyMicro, 795000);
  assert.equal(base.kind, 'ai'); assert.equal(base.hardBoundVerified, true);
  assert.notEqual(base.pricingVersion, createAiCostReservation({ ...config, jpyMicrosPerUsd: 151000000 }, bounds).pricingVersion);
  assert.notEqual(base.pricingVersion, createAiCostReservation(config, { ...bounds, tokenBoundEvidence: 'new-verification' }).pricingVersion);
  const search = createAiCostReservation(config, { ...bounds, maxSearchQueries: 2, searchBoundEvidence: 'fixture-only-query-cap' });
  assert.equal(search.kind, 'search'); assert.equal(search.upperBoundJpyMicro, 4995000);
});

test('secret reader and price calculator integrate with paid-call gate using anonymous adapters', async () => {
  const gate = createAiBudgetGate(memoryDb(), { clock: () => new Date('2026-10-06T00:00:00Z'), limitMicros: 1000000 });
  let secretReads = 0, dispatches = 0;
  const read = createPinnedSecretReader({ allowedReferences: [reference], credential, fetchImpl: async () => { secretReads++; return new Response(JSON.stringify(payload())); } });
  const call = createBudgetedProvider({ gate,
    prepare: async input => ({ request: input, cost: createAiCostReservation(config, bounds) }),
    dispatch: async () => {
      dispatches++; assert.deepEqual(await read(reference), secret);
      return { value: '匿名回答', actualJpyMicro: calculateAiCostMicros(config, { inputTokens: 1000, outputTokens: 1000, searchQueries: 0 }) };
    },
  });
  assert.equal((await call({ message: '匿名質問' }, { operationId: 'first' })).allowed, true);
  assert.equal((await call({ message: '次の匿名質問' }, { operationId: 'second' })).code, 'MONTHLY_BUDGET_EXHAUSTED');
  assert.equal(secretReads, 1); assert.equal(dispatches, 1);
});
