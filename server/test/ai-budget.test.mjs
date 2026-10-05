import test from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, BUDGET_FALLBACK, createAiBudgetGate } from '../ai-budget.mjs';
import { validateSecretReference, validateAiRuntimeConfig } from '../runtime-config.mjs';

import { memoryDb } from './budget-fixture.mjs';

test('replay rejection always supplies a reason and degradation policy without redispatch', async () => {
  let now = new Date('2026-10-31T14:59:59Z');
  const gate = createAiBudgetGate(memoryDb(), { clock: () => now, limitMicros: 100 });
  const input = operationId => ({ operationId, kind: 'ai', model: 'gemini-3.5-flash-lite', upperBoundJpyMicro: 10, pricingVersion: 'fixture', hardBoundVerified: true });
  const reject = async (id, code, state) => {
    const result = await gate.reserve(input(id));
    assert.deepEqual(result, { allowed: false, code, fallback: BUDGET_FALLBACK, reservationId: id, state, replay: true });
    assert.equal(await gate.claimDispatch(id), false);
  };
  await gate.reserve(input('expired'));
  assert.equal((await gate.reserve(input('expired'))).allowed, true);
  for (const state of ['dispatched', 'unknown', 'settled', 'cancelled']) {
    await gate.reserve(input(state));
    if (state === 'cancelled') await gate.cancel(state);
    else {
      assert.equal(await gate.claimDispatch(state), true);
      if (state === 'unknown') await gate.markUnknown(state);
      if (state === 'settled') await gate.settle(state, 5);
    }
    await reject(state, 'OPERATION_NOT_RESERVABLE', state);
  }
  now = new Date('2026-10-31T15:00:00Z');
  await reject('expired', 'RESERVATION_MONTH_EXPIRED', 'reserved');
  await gate.cancel('expired');
  assert.equal((await gate.reserve(input('new-month'))).allowed, true);
});
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
