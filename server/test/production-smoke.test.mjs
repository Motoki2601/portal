import test from 'node:test';
import assert from 'node:assert/strict';
import { runProductionSmoke } from '../production-smoke.mjs';

const config = { baseUrl: 'https://api.example.test', idToken: 'private-fixture-token', expectedUid: 'fixture-owner', origin: 'https://portal.example.test' };
function provider({ wrongUid = false, historyShape = true, networkError = false } = {}) {
  const requests = [];
  return { requests, async fetchImpl(url, options) {
    requests.push({ url, ...options });
    if (networkError) throw Error(config.idToken);
    const path = new URL(url).pathname;
    let status = 200, body = {};
    if (options.method === 'OPTIONS') status = 204;
    else if (options.headers.Origin === 'https://forbidden.invalid') status = 403;
    else if (path === '/health') body = { status: 'ok' };
    else if (!options.headers.Authorization || options.headers.Authorization === 'Bearer deliberately-invalid') status = 401;
    else if (options.headers.Authorization === 'Bearer other-private-token') status = 403;
    else if (path === '/me') body = { uid: wrongUid ? 'unexpected-user' : config.expectedUid };
    else body = historyShape ? { items: [], nextCursor: null } : {};
    const headers = options.headers.Origin === config.origin ? { 'access-control-allow-origin': config.origin } : {};
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  } };
}
test('smoke performs read-only checks, validates identity and never reports credentials', async () => {
  const mock = provider();
  const report = await runProductionSmoke({ ...config, otherUserToken: 'other-private-token', fetchImpl: mock.fetchImpl });
  assert.equal(report.results.length, 8);
  assert.ok(mock.requests.every(r => ['GET', 'OPTIONS'].includes(r.method)));
  assert.ok(mock.requests.every(r => r.redirect === 'error' && r.signal instanceof AbortSignal));
  for (const value of [config.idToken, config.expectedUid, 'other-private-token']) assert.ok(!JSON.stringify(report).includes(value));
});
test('wrong UID and malformed history fail the intended checks', async () => {
  await assert.rejects(runProductionSmoke({ ...config, fetchImpl: provider({ wrongUid: true }).fetchImpl }), /verified-user: invalid response/);
  await assert.rejects(runProductionSmoke({ ...config, fetchImpl: provider({ historyShape: false }).fetchImpl }), /purchase-history: invalid response/);
});
test('invalid target config fails before networking; provider errors remain private', async () => {
  let called = false;
  const fetchImpl = () => { called = true; };
  for (const baseUrl of ['http://api.example.test', 'https://api.example.test/path', 'https://user:secret@api.example.test'])
    await assert.rejects(runProductionSmoke({ ...config, baseUrl, fetchImpl }), /Invalid smoke configuration/);
  assert.equal(called, false);
  await assert.rejects(runProductionSmoke({ ...config, fetchImpl: provider({ networkError: true }).fetchImpl }), e => e.message === 'health: request failed' && !e.message.includes(config.idToken));
});

test('smoke agrees with actual HTTP/Application purchase history contract', async t => {
  const { once } = await import('node:events');
  const { createApplication } = await import('../application.mjs');
  const { createApi } = await import('../http.mjs');
  const application = createApplication({ readHistory: async () => ({ orders: [], lines: [], products: [] }) });
  const api = createApi({
    application, allowedUids: [config.expectedUid], allowedOrigins: [config.origin],
    verifyToken: async token => {
      if (token === 'deliberately-invalid') throw Object.assign(Error(), { code: 'auth/invalid-id-token' });
      return { uid: token === config.idToken ? config.expectedUid : 'other-user' };
    },
  });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  t.after(() => new Promise(resolve => { api.close(resolve); api.closeAllConnections(); }));
  const local = 'http://127.0.0.1:' + api.address().port;
  const report = await runProductionSmoke({ ...config, otherUserToken: 'other-private-token',
    fetchImpl: (url, options) => fetch(local + new URL(url).pathname + new URL(url).search, options),
  });
  assert.equal(report.results.length, 8);
});
