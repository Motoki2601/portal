import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateProposal } from '../amazon-csv.mjs';
import { createApi } from '../http.mjs';
import { createApplication } from '../application.mjs';
import { csvFixture } from './csv-fixture.mjs';

test('Python CSV proposals match Node identities and reject unsafe fields', () => {
  const fixture = csvFixture();
  assert.equal(validateProposal(fixture).o.orderedOn, '2026-09-02');
  for (const mutate of [
    f => { f.uid = 'other'; }, f => { f.source.address = 'private'; },
    f => { f.source.sourceId = 'forged'; }, f => { f.importBatchKey = 'forged'; },
    f => { f.order.orderKey = 'forged'; }, f => { f.order.lines[0].productId = 'forged'; },
    f => { f.order.lines[0].quantity = 2 ** 53; }, f => { f.order.lines[0].amountMinor = 900; },
    f => { f.order.lines[0].reasonCodes = ['untrusted']; },
    f => { f.order.lines[0].fieldOrigins.quantity.kind = 'user'; },
    f => { f.order.lines[0].orderedOn = '2026-08-01'; },
    f => { f.order.lines[0].orderDateEvidence = '2026-09-01T24:00:00Z'; },
    f => { f.order.lines.push(structuredClone(f.order.lines[0])); },
  ]) {
    const changed = structuredClone(fixture); mutate(changed);
    assert.throws(() => validateProposal(changed), e => e.code === 'INVALID_ARGUMENT');
  }
});

test('CSV HTTP operation authenticates and passes only token uid', async t => {
  const calls = [];
  const application = createApplication({ importAmazonCsv: async (uid, body) => { validateProposal(body); calls.push(uid); return { status: 'imported' }; } });
  const api = createApi({ application, verifyToken: async token => ({ uid: token }), allowedUids: ['owner'], allowedOrigins: ['http://localhost:5173'] });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  t.after(() => new Promise(resolve => { api.close(resolve); api.closeAllConnections(); }));
  const url = `http://127.0.0.1:${api.address().port}/imports/amazon-csv`;
  const body = csvFixture();
  const post = (value, token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, 'other')).status, 403);
  assert.equal((await post({ ...body, uid: 'other' }, 'owner')).status, 400);
  assert.equal((await post(body, 'owner')).status, 200);
  assert.deepEqual(calls, ['owner']);
});
