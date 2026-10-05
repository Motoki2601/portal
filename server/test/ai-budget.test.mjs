import test from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, BUDGET_FALLBACK, createAiBudgetGate } from '../ai-budget.mjs';
import { validateSecretReference, validateAiRuntimeConfig } from '../runtime-config.mjs';
test('JST month boundary and invalid clock', () => {
  assert.equal(monthKey(new Date('2026-10-31T14:59:59Z')), '2026-10');
  assert.equal(monthKey(new Date('2026-10-31T15:00:00Z')), '2026-11');
  assert.throws(() => monthKey(new Date('invalid')));
  assert.throws(() => createAiBudgetGate({}, { limitMicros: 700000001 }));
  assert.deepEqual(BUDGET_FALLBACK, { deferImports: true, history: true, replenishment: true, notificationPrice: false });
});
test('configuration fails closed without pinned credentials, approved model, pricing/FX', () => {
  const config = { model: 'gemini-3.5-flash-lite', apiKeySecret: 'projects/demo-portal/secrets/gemini/versions/1', pricingVersion: 'test-fixture-only', jpyMicrosPerUsd: 1000000, inputUsdMicrosPerMillion: 1, outputUsdMicrosPerMillion: 1, searchUsdMicrosPerQuery: 1 };
  assert.equal(validateAiRuntimeConfig(config).model, config.model);
  assert.throws(() => validateSecretReference(config.apiKeySecret.replace('/1', '/latest')));
  for (const field of ['jpyMicrosPerUsd', 'inputUsdMicrosPerMillion', 'outputUsdMicrosPerMillion', 'searchUsdMicrosPerQuery']) assert.throws(() => validateAiRuntimeConfig({ ...config, [field]: undefined }));
  assert.throws(() => validateAiRuntimeConfig({ ...config, model: 'other' }));
});
