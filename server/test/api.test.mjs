import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from '../application.mjs';
import { createApi } from '../http.mjs';

const orders = [{ id: 'order-a', orderedOn: '2026-07-01', revision: 2, userOverrides: { orderedOn: { value: '2026-07-04', observationId: 'correction-a' } } }, { id: 'order-b', orderedOn: '2026-07-03', revision: 1 }];
const lines = [{ id: 'line-a', orderId: 'order-a', productId: 'product-a', quantity: 2, amountMinor: 900 }, { id: 'line-b', orderId: 'order-b', productId: 'product-b', quantity: null, amountMinor: null }];
const products = [{ id: 'product-a', canonicalName: '架空クリーナー' }, { id: 'product-b', canonicalName: '架空石けん' }];
test('HTTP authentication, origin, validation and uid boundary', async t => {
  const calls = [];
  const application = createApplication({ readHistory: async uid => { calls.push(uid); return { orders, lines, products }; }, recordState: async (uid, value) => { calls.push(uid); return { observationId: value.observationId }; } }, () => new Date('2026-10-05T00:00:00Z'));
  const server = createApi({ application, allowedUids: ['owner'], allowedOrigins: ['https://motoki2601.github.io'], verifyToken: async token => {
    if (['expired', 'wrong-project', 'revoked'].includes(token)) throw Object.assign(Error(), { code: token === 'expired' ? 'auth/id-token-expired' : token === 'revoked' ? 'auth/id-token-revoked' : 'auth/argument-error' });
    if (token === 'unavailable') throw Object.assign(Error(), { code: 'auth/internal-error' });
    return { uid: token === 'owner-token' ? 'owner' : 'other' };
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = (path, token, extra = {}) => fetch(url + path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra } });
  assert.equal((await get('/health')).status, 200);
  assert.equal((await get('/me')).status, 401);
  for (const token of ['expired', 'wrong-project', 'revoked']) assert.equal((await get('/purchase-history', token)).status, 401);
  assert.equal((await get('/me', 'unavailable')).status, 503);
  assert.equal((await get('/me', 'other-token')).status, 403);
  assert.equal((await get('/me', 'owner-token', { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await get('/me', 'owner-token')).status, 200);
  assert.deepEqual(await (await get('/me', 'owner-token')).json(), { uid: 'owner' });
  for (const query of ['uid=other', 'productId=..%2Fother', 'limit=101', 'limit=0', 'limit=2&limit=3', 'fromOn=2026-02-30', 'cursor=garbage']) assert.equal((await get('/purchase-history?' + query, 'owner-token')).status, 400);
  const first = await (await get('/purchase-history?limit=1', 'owner-token')).json();
  assert.equal(first.items[0].order.orderedOn, '2026-07-04');
  assert.equal(first.items[0].origins.order.orderedOn.kind, 'user');
  const second = await (await get('/purchase-history?limit=1&cursor=' + first.nextCursor, 'owner-token')).json();
  assert.equal(second.items[0].line.quantity, null); assert.equal(second.nextCursor, null);
  assert.equal((await get('/purchase-history?productId=product-a&cursor=' + first.nextCursor, 'owner-token')).status, 400);
  const body = { clientMutationId: 'mutation-a', productId: 'product-a', kind: 'state', value: 'spare_available' };
  const post = value => fetch(url + '/user-observations', { method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await post({ ...body, uid: 'other' })).status, 400);
  assert.equal((await post({ ...body, kind: 'correction' })).status, 400);
  assert.equal((await post({ ...body, observedAt: '2026-02-30T00:00:00Z' })).status, 400);
  for (const observedAt of ['2026-09-01T24:00:00Z', '2026-09-01T12:60:00Z', '2026-09-01T12:00:60Z', '2026-09-01T12:00:00+24:00', '2026-09-01T12:00:00+01:60']) {
    assert.equal((await post({ ...body, observedAt })).status, 400);
  }
  assert.equal((await post({ ...body, observedAt: '2026-09-01T23:59:59.999+09:00' })).status, 200);
  assert.equal((await post({ ...body, note: 'x'.repeat(10000) })).status, 413);
  assert.equal((await post(body)).status, 200);
  assert(calls.every(uid => uid === 'owner'));
  const preflight = await fetch(url + '/purchase-history', { method: 'OPTIONS', headers: { Origin: 'https://motoki2601.github.io', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://motoki2601.github.io');
  assert.equal((await get('/arbitrary-db-query', 'owner-token')).status, 404);
});
