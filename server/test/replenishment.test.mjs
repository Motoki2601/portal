import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReplenishment, jstDay } from '../replenishment.mjs';
import { createApplication } from '../application.mjs';
import { createApi } from '../http.mjs';
import { once } from 'node:events';
const now = new Date('2026-10-05T00:00:00Z');
const input = () => ({ orders: [{ id: 'a', orderedOn: '2026-08-01', status: 'ordered', identityStatus: 'confirmed', revision: 1 }, { id: 'b', orderedOn: '2026-09-01', status: 'ordered', identityStatus: 'confirmed', revision: 1 }], lines: [{ id: 'a', orderId: 'a', productId: 'p', status: 'ordered', quantity: 2 }, { id: 'b', orderId: 'b', productId: 'p', status: 'ordered', quantity: 1 }], products: [{ id: 'p', category: 'unknown', replenishmentStatus: 'candidate' }], states: [] });
const result = (data = input(), time = now) => calculateReplenishment(data, time).items[0];

test('31-day cycle, notification seven days before, quantities and same-day collapse', () => {
  const data = input(); data.lines.push({ ...data.lines[0], id: 'same-day' });
  const r = result(data);
  assert.equal(r.calculation.purchaseCount, 2); assert.equal(r.calculation.intervalCount, 1);
  assert.equal(r.calculation.medianIntervalDays, 31); assert.equal(r.prediction.estimatedNextPurchaseOn, '2026-10-02');
  assert.equal(r.prediction.notifyFrom, '2026-09-25'); assert.equal(r.prediction.confidence, 'low');
  assert(r.candidate.eligible);
  assert.equal(jstDay(new Date('2026-10-04T15:00:00Z')), '2026-10-05');
});
test('cancelled, returned, provisional, future and unmatched rows excluded', () => {
  for (const change of [d => d.orders[0].status = 'cancelled', d => d.lines[0].status = 'returned', d => d.orders[0].identityStatus = 'provisional', d => d.orders[0].orderedOn = '2027-08-01', d => d.lines[0].productId = null]) {
    const d = input(); change(d); const r = result(d);
    assert.equal(r.calculation.basis, 'none'); assert.equal(r.prediction.estimatedNextPurchaseOn, null); assert(!r.candidate.eligible);
  }
});
test('effective corrections change cycle and fingerprint; explicit null stays unmatched', () => {
  const d = input(), old = result(d);
  d.orders[1].userOverrides = { orderedOn: { value: '2026-09-10', observationId: 'user-date' } };
  assert.equal(result(d).calculation.medianIntervalDays, 40);
  assert.notEqual(result(d).calculation.inputFingerprint, old.calculation.inputFingerprint);
  d.lines[0].userOverrides = { productId: { value: null, observationId: 'unmatch' } };
  assert.equal(result(d).calculation.intervalCount, 0);
});
test('suppression expires without clearing user state; exclusions take priority', () => {
  const d = input(); d.states = [{ id: 'p', state: 'spare_available', origin: 'user', usage: 'current', suppressUntil: '2026-10-12T00:00:00Z' }];
  assert(!result(d).candidate.eligible);
  const expired = result(d, new Date('2026-10-12T00:00:00Z'));
  assert(expired.candidate.eligible); assert.equal(expired.state.state, 'spare_available');
  assert(expired.candidate.reasonCodes.includes('past_available_observation'));
  d.products[0].userOverrides = { replenishmentStatus: { value: 'excluded', observationId: 'exclude' } };
  assert(!result(d, new Date('2026-10-12T00:00:00Z')).candidate.eligible);
});
test('category fallback and newer category purchases respect explicit current', () => {
  const d = input(); d.products[0].category = 'cleaner'; d.products.push({ id: 'other', category: 'cleaner', replenishmentStatus: 'candidate' }); d.lines[0].productId = 'other';
  assert.equal(result(d).calculation.basis, 'category'); assert.equal(result(d).prediction.confidence, 'low');
  const older = calculateReplenishment(d, now).items.find(x => x.product.id === 'other');
  assert(!older.candidate.eligible); assert(older.candidate.reasonCodes.includes('newer_category_product'));
  d.states = [{ id: 'other', state: 'unknown', usage: 'current', usageOrigin: 'user' }];
  assert(calculateReplenishment(d, now).items.find(x => x.product.id === 'other').candidate.eligible);
});
test('out-of-stock bypasses insufficient cycle only for an eligible current product', () => {
  const d = input(); d.lines.pop(); d.states = [{ id: 'p', state: 'out_of_stock', origin: 'user', usage: 'current', usageOrigin: 'user' }];
  assert(result(d).candidate.eligible);
  d.states[0].usage = 'not_current'; assert(!result(d).candidate.eligible);
});
test('median half-day rounding and confidence for two intervals', () => {
  const d = input(); d.orders.push({ id: 'c', orderedOn: '2026-08-11', identityStatus: 'confirmed', status: 'ordered' });
  d.lines.push({ id: 'c', orderId: 'c', productId: 'p', status: 'ordered' });
  const r = result(d);
  assert.equal(r.calculation.medianIntervalDays, 15.5); assert.equal(r.calculation.averageIntervalDays, 15.5);
  assert.equal(r.prediction.estimatedNextPurchaseOn, '2026-09-17'); assert.equal(r.prediction.confidence, 'medium');
});
test('new operations enforce authentication, empty mutation input and candidate filtering', async t => {
  const calls = [];
  const application = createApplication({ getReplenishment: async uid => { calls.push(uid); return { asOf: '2026-10-05', items: [{ candidate: { eligible: true } }, { candidate: { eligible: false } }] }; }, matchProducts: async uid => { calls.push(uid); return { matchedLines: 1 }; } });
  const api = createApi({ application, verifyToken: async token => ({ uid: token }), allowedUids: ['owner'], allowedOrigins: ['http://localhost:5173'] });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  t.after(() => new Promise(resolve => { api.close(resolve); api.closeAllConnections(); }));
  const url = `http://127.0.0.1:${api.address().port}`;
  const get = (path, token) => fetch(url + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await get('/replenishment-candidates')).status, 401);
  assert.equal((await get('/replenishment-estimates', 'other')).status, 403);
  assert.equal((await get('/replenishment-candidates?uid=other', 'owner')).status, 400);
  assert.equal((await (await get('/replenishment-candidates', 'owner')).json()).items.length, 1);
  assert.equal((await (await get('/replenishment-estimates', 'owner')).json()).items.length, 2);
  const post = body => fetch(url + '/purchase-history/match-products', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ uid: 'other' })).status, 400);
  assert.equal((await post({})).status, 200);
  assert(calls.every(uid => uid === 'owner'));
});
