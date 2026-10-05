import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from '../application.mjs';
import { createConversationApplication, contextItem } from '../conversation.mjs';
import { createCommerceTools, runCommerceConversation } from '../tools.mjs';
import { createApi } from '../http.mjs';
import { calculateReplenishment } from '../replenishment.mjs';
const clock = () => new Date('2026-10-05T00:00:00Z');
const products = [{ id: 'old', category: 'shampoo', replenishmentStatus: 'candidate', revision: 1 }, { id: 'new', category: 'shampoo', replenishmentStatus: 'candidate', revision: 1 }];
const orders = [{ id: 'a', orderedOn: '2026-08-01', status: 'ordered', identityStatus: 'confirmed' }, { id: 'b', orderedOn: '2026-09-01', status: 'ordered', identityStatus: 'confirmed' }];
const lines = [{ id: 'a', orderId: 'a', productId: 'old', status: 'ordered' }, { id: 'b', orderId: 'b', productId: 'new', status: 'ordered' }];
const repo = { readConversationSnapshot: async () => ({ products, orders, lines, states: [] }), readHistory: async () => ({ products, orders, lines }), getReplenishment: async () => calculateReplenishment({ products, orders, lines, states: [] }, clock()), correctRecord: async (uid, input) => ({ uid, input }), recordUsage: async (uid, input) => ({ uid, input }), saveRecommendation: async (uid, input) => ({ uid, input }) };
function app() { const a = createApplication(repo, clock); return Object.assign(a, createConversationApplication(a, repo, clock)); }
const recommendation = { clientMutationId: 'rec', productId: 'new', contextFingerprint: 'a'.repeat(64), rationale: '確認時期のため', recommendedProduct: { name: '架空シャンプー' }, alternatives: [], currentPrice: null };
test('current inference uses own purchase dates rather than category fallback', async () => {
  const result = await app().getCurrentProduct('owner', { category: 'shampoo' });
  assert.equal(result.origin, 'inference'); assert.equal(result.ambiguous, false); assert.deepEqual(result.items.map(x => x.product.id), ['new']);
  assert.equal((await app().getCurrentProduct('owner', { category: 'unknown' })).origin, 'unknown');
  const original = (await repo.getReplenishment()).items[0], later = structuredClone(original);
  later.calculation.calculatedAt = 'tomorrow'; later.candidate.evaluatedAt = 'tomorrow';
  assert.equal(contextItem(original).contextFingerprint, contextItem(later).contextFingerprint);
  later.state.usage = 'not_current'; assert.notEqual(contextItem(original).contextFingerprint, contextItem(later).contextFingerprint);
});
test('correction and researched price inputs are strictly validated', async () => {
  const a = app(), correction = { clientMutationId: 'fix', collection: 'purchaseLines', id: 'a', field: 'productId', action: 'set', value: null, expectedRevision: 1 };
  assert.equal((await a.correctRecord('owner', correction)).input.value, null);
  for (const bad of [{ ...correction, uid: 'other' }, { ...correction, collection: '__proto__' }, { ...correction, field: 'sourceId' }, { ...correction, field: 'quantity', value: -1 }, { ...correction, action: 'release' }, { ...correction, expectedRevision: -1 }, { ...correction, value: '../other' }]) await assert.rejects(a.correctRecord('owner', bad), e => e.code === 'INVALID_ARGUMENT');
  assert.equal((await a.saveRecommendation('owner', recommendation)).input.currentPrice, null);
  const price = { amountMinor: 950, currency: 'JPY', sourceUrl: 'https://example.invalid/item', observedAt: '2026-10-04T00:00:00.000Z' };
  assert.equal((await a.saveRecommendation('owner', { ...recommendation, currentPrice: price })).input.currentPrice.amountMinor, 950);
  for (const bad of [{ ...price, amountMinor: 1.5 }, { ...price, sourceUrl: 'http://example.invalid' }, { ...price, sourceUrl: 'https://user:secret@example.invalid' }, { ...price, observedAt: '2026-02-30T00:00:00.000Z' }, { ...price, observedAt: '2026-10-06T00:00:00.000Z' }, { ...price, uid: 'other' }]) await assert.rejects(a.saveRecommendation('owner', { ...recommendation, currentPrice: bad }), e => e.code === 'INVALID_ARGUMENT');
});
test('model cannot self-grant user mutations or arbitrary database access', async () => {
  const input = { clientMutationId: 'fix', collection: 'products', id: 'new', field: 'category', action: 'set', value: 'shampoo', expectedRevision: 1 };
  const tools = createCommerceTools({ application: app(), uid: 'owner', requestId: 'req' });
  for (const name of ['correct_purchase_record', 'record_product_usage', 'firestore_query', '__proto__']) await assert.rejects(tools.execute(name, input), e => e.code === 'FORBIDDEN');
  await assert.rejects(tools.execute('get_product_context', { productId: 'new', uid: 'other' }), e => e.code === 'INVALID_ARGUMENT');
  for (const args of [{ limit: false }, { limit: 101 }, { productId: ['new'] }, { cursor: [] }]) await assert.rejects(tools.execute('get_purchase_history', args), e => e.code === 'INVALID_ARGUMENT');
  const granted = createCommerceTools({ application: app(), uid: 'owner', requestId: 'req', userMutations: [{ name: 'correct_purchase_record', arguments: input }] });
  assert.equal((await granted.execute('correct_purchase_record', input)).uid, 'owner');
  await assert.rejects(granted.execute('correct_purchase_record', { ...input, value: 'soap' }), e => e.code === 'FORBIDDEN');
});
test('Japanese question routes through bounded provider-neutral tool loop', async () => {
  const tools = createCommerceTools({ application: app(), uid: 'owner', requestId: 'req' }); let calls = 0;
  const result = await runCommerceConversation({ message: 'このシャンプー最後いつ買った？', tools, model: async ({ messages, tools: defs }) => {
    assert(!defs.some(x => x.name === 'correct_purchase_record'));
    if (!calls++) return { toolCalls: [{ id: '1', name: 'get_purchase_history', arguments: { productId: 'new', limit: 1 } }] };
    assert.equal(messages.at(-1).result.items[0].order.orderedOn, '2026-09-01');
    return { text: '最後の購入日は2026年9月1日です。' };
  } }); assert.equal(result.toolCallCount, 1);
  await assert.rejects(runCommerceConversation({ message: '質問', tools, maxTurns: 1, model: async () => ({ toolCalls: [{ id: '1', name: 'firestore_query', arguments: {} }] }) }), e => e.code === 'RESOURCE_EXHAUSTED');
});
test('new HTTP routes preserve token authentication and deny model write escalation', async t => {
  const api = createApi({ application: app(), verifyToken: async token => ({ uid: token }), allowedUids: ['owner'], allowedOrigins: ['https://portal.invalid'] });
  api.listen(0, '127.0.0.1'); await once(api, 'listening'); t.after(() => new Promise(r => { api.close(r); api.closeAllConnections(); }));
  const post = (path, body, token = 'owner') => fetch(`http://127.0.0.1:${api.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const context = { name: 'get_product_context', arguments: { productId: 'new' } };
  assert.equal((await post('/tools/call', context, null)).status, 401); assert.equal((await post('/tools/call', context, 'other')).status, 403);
  assert.equal((await post('/tools/call', context)).status, 200);
  assert.equal((await post('/tools/call', { ...context, userMutations: ['correct_purchase_record'] })).status, 400);
  assert.equal((await post('/tools/call', { name: 'correct_purchase_record', arguments: {} })).status, 403);
  assert.equal((await post('/corrections', { uid: 'other' })).status, 400);
  assert.equal((await post('/product-usage', { clientMutationId: 'use', productId: 'new', value: 'current', expectedRevision: 0 })).status, 200);
  assert.equal((await post('/recommendations', { ...recommendation, uid: 'other' })).status, 400);
  assert.equal((await post('/tools/call?uid=other', context)).status, 400);
});

test('HTTP accepts maximum recommendation fields directly and through tools, with bounded bodies', async t => {
  const a = app();
  const prefix = 'https://example.invalid/';
  const url = prefix + '品'.repeat(2048 - prefix.length);
  const price = { amountMinor: Number.MAX_SAFE_INTEGER, currency: 'JPY', sourceUrl: url, observedAt: '2026-10-04T00:00:00.000Z' };
  const input = { ...recommendation, clientMutationId: 'm'.repeat(128), productId: 'p'.repeat(128), rationale: '理'.repeat(2000), recommendedProduct: { name: '品'.repeat(500), url }, currentPrice: price, aiModel: '模'.repeat(100), alternatives: Array.from({ length: 5 }, () => ({ name: '品'.repeat(500), url, rationale: '理'.repeat(1000), currentPrice: price })) };
  await a.saveRecommendation('owner', input); // Prove that the application accepts this input.
  const api = createApi({ application: a, verifyToken: async () => ({ uid: 'owner' }), allowedUids: ['owner'], allowedOrigins: ['https://portal.invalid'] });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  t.after(() => new Promise(r => { api.close(r); api.closeAllConnections(); }));
  const post = (path, body) => fetch(`http://127.0.0.1:${api.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body });
  // Escaped Unicode is valid JSON and takes six bytes per character on the wire.
  const encode = value => JSON.stringify(value).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  for (const [path, value] of [['/recommendations', input], ['/tools/call', { name: 'save_recommendation', arguments: input }]]) {
    const body = encode(value);
    assert(Buffer.byteLength(body) > 8192);
    assert(Buffer.byteLength(body) < 256 * 1024);
    const response = await post(path, body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).input.alternatives.length, 5);
    const atLimit = body + ' '.repeat(256 * 1024 - Buffer.byteLength(body));
    assert.equal((await post(path, atLimit)).status, 200);
    assert.equal((await post(path, atLimit + ' ')).status, 413);
  }
  // Small mutation routes retain their original limit.
  assert.equal((await post('/corrections', '{}' + ' '.repeat(8191))).status, 413);
});
