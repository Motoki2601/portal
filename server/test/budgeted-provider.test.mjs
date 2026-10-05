import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiBudgetGate, BUDGET_FALLBACK } from '../ai-budget.mjs';
import { createBudgetedProvider } from '../budgeted-provider.mjs';
import { memoryDb } from './budget-fixture.mjs';
import { runCommerceConversation } from '../tools.mjs';

const cost = { kind: 'ai', model: 'gemini-3.5-flash-lite', upperBoundJpyMicro: 60, pricingVersion: 'anonymous-fixture', hardBoundVerified: true };
const reserve = (gate, id, amount = 60) => gate.reserve({ ...cost, operationId: id, upperBoundJpyMicro: amount });
const clock = () => new Date('2026-10-05T00:00:00Z');
function setup({ limit = 100, prepare = async input => ({ request: input, cost }), dispatch = async () => ({ value: { text: '匿名回答' }, actualJpyMicro: 30 }) } = {}) {
  const gate = createAiBudgetGate(memoryDb(), { clock, limitMicros: limit });
  let calls = 0;
  const call = createBudgetedProvider({ gate, prepare, dispatch: async (...args) => { calls++; return dispatch(...args); } });
  return { gate, call, calls: () => calls };
}
const denied = (result, code) => { assert.equal(result.allowed, false); assert.equal(result.code, code); assert.deepEqual(result.fallback, BUDGET_FALLBACK); };

test('settlement releases unused budget and replay never redispatches', async () => {
  const { gate, call, calls } = setup();
  assert.deepEqual(await call({ anonymous: true }, { operationId: 'first' }), { allowed: true, value: { text: '匿名回答' } });
  denied(await call({ anonymous: true }, { operationId: 'first' }), 'OPERATION_NOT_RESERVABLE');
  assert.equal(calls(), 1);
  assert.equal((await reserve(gate, 'remaining', 70)).allowed, true);
  denied(await call({}, { operationId: 'blocked' }), 'MONTHLY_BUDGET_EXHAUSTED');
  assert.equal(calls(), 1);
});

test('same operation rejects changed request content but accepts reordered JSON keys', async () => {
  const { gate, call, calls } = setup();
  const original = gate.claimDispatch.bind(gate);
  gate.claimDispatch = async () => false;
  denied(await call({ a: 1, b: 2 }, { operationId: 'request-bound' }), 'DISPATCH_NOT_GRANTED');
  denied(await call({ a: 9, b: 2 }, { operationId: 'request-bound' }), 'BUDGET_LEDGER_UNAVAILABLE');
  assert.equal(calls(), 0);
  gate.claimDispatch = original;
  assert.equal((await call({ b: 2, a: 1 }, { operationId: 'request-bound' })).allowed, true);
  assert.equal(calls(), 1);
});

test('unverified bounds and preparation errors do not dispatch', async () => {
  const unsafe = setup({ prepare: async () => ({ request: {}, cost: { ...cost, hardBoundVerified: false } }) });
  denied(await unsafe.call({}, { operationId: 'unbounded' }), 'UNVERIFIED_COST_BOUND');
  assert.equal(unsafe.calls(), 0);
  const broken = setup({ prepare: async () => { throw new Error('secret fixture MUST NOT escape'); } });
  const result = await broken.call({}, { operationId: 'broken' });
  denied(result, 'PROVIDER_PREPARATION_FAILED');
  assert(!JSON.stringify(result).includes('secret fixture'));
  assert.equal(broken.calls(), 0);
});

test('provider timeout and missing usage retain holds and prevent retries', async () => {
  for (const dispatch of [async () => { throw new Error('sensitive provider message'); }, async () => ({ value: 'response without usage' })]) {
    const { gate, call, calls } = setup({ dispatch });
    denied(await call({}, { operationId: 'unknown' }), 'PROVIDER_RESULT_UNKNOWN');
    const replay = await call({}, { operationId: 'unknown' });
    denied(replay, 'OPERATION_NOT_RESERVABLE');
    assert.equal(replay.state, 'unknown');
    assert.equal(calls(), 1);
    assert.equal((await reserve(gate, 'held-budget', 41)).allowed, false);
    await assert.rejects(gate.cancel('unknown'));
  }
});

test('reserve/claim storage failures fail closed even when claim actually committed', async () => {
  for (const stage of ['reserve', 'claimDispatch']) {
    const { gate } = setup();
    const real = gate[stage].bind(gate);
    gate[stage] = async (...args) => { if (stage === 'claimDispatch') await real(...args); throw new Error('storage failure'); };
    let calls = 0;
    const call = createBudgetedProvider({ gate, prepare: async () => ({ request: {}, cost }), dispatch: async () => { calls++; } });
    denied(await call({}, { operationId: 'failure' }), 'BUDGET_LEDGER_UNAVAILABLE');
    assert.equal(calls, 0);
    if (stage === 'claimDispatch') {
      gate[stage] = real;
      assert.equal(await gate.claimDispatch('failure'), false);
      await assert.rejects(gate.cancel('failure'));
    }
  }
});

test('settlement and unknown-write failures still leave a non-reissuable hold', async () => {
  const { gate, call, calls } = setup();
  gate.settle = async () => { throw new Error('ledger offline'); };
  gate.markUnknown = async () => { throw new Error('ledger offline'); };
  denied(await call({}, { operationId: 'lost-settlement' }), 'PROVIDER_RESULT_UNKNOWN');
  const result = await call({}, { operationId: 'lost-settlement' });
  denied(result, 'OPERATION_NOT_RESERVABLE');
  assert.equal(result.state, 'dispatched');
  assert.equal((await reserve(gate, 'still-held', 41)).allowed, false);
  assert.equal(calls(), 1);
});

test('actual overrun is recorded and stops future calls', async () => {
  const { call, calls } = setup({ dispatch: async () => ({ value: 'overrun', actualJpyMicro: 61 }) });
  denied(await call({}, { operationId: 'overrun' }), 'COST_OVERRUN');
  denied(await call({}, { operationId: 'next' }), 'COST_OVERRUN');
  assert.equal(calls(), 1);
});

test('abort before reserve, before claim, and after claim never frees ambiguous holds', async () => {
  const before = new AbortController(); before.abort();
  const early = setup();
  denied(await early.call({}, { operationId: 'early', signal: before.signal }), 'CALL_CANCELLED');
  assert.equal(early.calls(), 0);
  assert.equal((await reserve(early.gate, 'all-free', 100)).allowed, true);
  for (const stage of ['reserve', 'claimDispatch']) {
    const controller = new AbortController(), { gate, call, calls } = setup();
    const original = gate[stage].bind(gate);
    gate[stage] = async (...args) => { const result = await original(...args); controller.abort(); return result; };
    denied(await call({}, { operationId: stage, signal: controller.signal }), stage === 'reserve' ? 'CALL_CANCELLED' : 'PROVIDER_RESULT_UNKNOWN');
    assert.equal(calls(), 0);
    const next = await reserve(gate, 'check-free', 100);
    assert.equal(next.allowed, stage === 'reserve');
  }
});

test('existing conversation loop reserves each model round and stops on exhausted budget', async () => {
  for (const limit of [100, 60]) {
    let providerTurns = 0, hostTurns = 0, toolCalls = 0;
    const { call, calls } = setup({ limit, dispatch: async () => ({
      value: providerTurns++ ? { text: '購入日は2026年9月1日です。' } : { toolCalls: [{ id: 'read', name: 'get_purchase_history', arguments: {} }] },
      actualJpyMicro: 30,
    }) });
    const conversation = runCommerceConversation({
      message: '最後の購入日は？', tools: { definitions: [], execute: async () => { toolCalls++; return { orderedOn: '2026-09-01' }; } },
      model: async input => {
        const outcome = await call(input, { operationId: `anonymous-conversation-turn-${hostTurns++}` });
        if (!outcome.allowed) throw Object.assign(new Error('Budget stopped'), { code: outcome.code });
        return outcome.value;
      },
    });
    if (limit === 100) assert.equal((await conversation).toolCallCount, 1);
    else await assert.rejects(conversation, error => error.code === 'MONTHLY_BUDGET_EXHAUSTED');
    assert.equal(toolCalls, 1);
    assert.equal(calls(), limit === 100 ? 2 : 1);
  }
});
