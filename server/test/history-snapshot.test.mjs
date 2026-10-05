import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../application.mjs';
import { createFirestoreRepository } from '../firestore.mjs';

// Import one complete order/line/product between collection reads. Transaction
// reads retain their captured snapshot; standalone reads see the new commit.
function concurrentImportDatabase() {
  const before = {
    purchaseOrders: [{ id: 'old-order', orderedOn: '2026-08-01' }],
    purchaseLines: [{ id: 'old-line', orderId: 'old-order', productId: 'old-product' }],
    products: [{ id: 'old-product', canonicalName: 'Old product' }],
  };
  const after = {
    purchaseOrders: [...before.purchaseOrders, { id: 'new-order', orderedOn: '2026-09-01' }],
    purchaseLines: [...before.purchaseLines, { id: 'new-line', orderId: 'new-order', productId: 'new-product' }],
    products: [...before.products, { id: 'new-product', canonicalName: 'New product' }],
  };
  let current = before;
  const snapshot = (query, version) => {
    const records = version[query.name].slice(0, query.limitValue);
    if (query.name === 'purchaseOrders') current = after;
    return { size: records.length, docs: records.map(({ id, ...data }) => ({ id, data: () => data })) };
  };
  return {
    collection(name) {
      assert.equal(name, 'users');
      return { doc(uid) {
        assert.equal(uid, 'owner');
        return { collection(name) { return { limit(limitValue) {
          const query = { name, limitValue };
          return { ...query, get: async () => snapshot(query, current) };
        } }; } };
      } };
    },
    async runTransaction(callback, options) {
      assert.deepEqual(options, { readOnly: true });
      const version = current;
      return callback({ get: async query => snapshot(query, version) });
    },
  };
}

test('purchase history remains coherent when an atomic import commits during reads', async () => {
  const repository = createFirestoreRepository(concurrentImportDatabase());
  const initial = await repository.readHistory('owner');
  assert.deepEqual(initial.orders.map(x => x.id), ['old-order']);
  assert.deepEqual(initial.lines.map(x => x.id), ['old-line']);
  assert.deepEqual(initial.products.map(x => x.id), ['old-product']);
  const app = createApplication(createFirestoreRepository(concurrentImportDatabase()));
  const first = await app.getPurchaseHistory('owner');
  // The first response is wholly before the import, never old orders combined
  // with a new orphan line or a new product.
  assert.deepEqual(first.items.map(x => x.line.id), ['old-line']);
  assert.equal(first.items[0].product.canonicalName, 'Old product');
  const snapshot = await repository.readHistory('owner');
  assert.deepEqual(snapshot.orders.map(x => x.id), ['old-order', 'new-order']);
  assert.deepEqual(snapshot.lines.map(x => x.id), ['old-line', 'new-line']);
  assert.deepEqual(snapshot.products.map(x => x.id), ['old-product', 'new-product']);
  const next = await app.getPurchaseHistory('owner');
  assert.deepEqual(next.items.map(x => x.line.id), ['new-line', 'old-line']);
  assert.equal(next.items[0].product.canonicalName, 'New product');
});

test('purchase history still rejects a collection beyond the 5000-document limit', async () => {
  const db = {
    collection: () => ({ doc: () => ({ collection: name => ({
      limit: limit => { assert.equal(limit, 5001); return { name, get: async () => ({ size: name === 'purchaseLines' ? 5001 : 0, docs: [] }) }; },
    }) }) }),
    runTransaction: async callback => callback({ get: async query => ({
      size: query.name === 'purchaseLines' ? 5001 : 0, docs: [],
    }) }),
  };
  await assert.rejects(createFirestoreRepository(db).readHistory('owner'),
    error => error.code === 'RESOURCE_EXHAUSTED' && error.status === 413);
});
