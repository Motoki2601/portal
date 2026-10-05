import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createCsvImporter, identity } from '../amazon-csv.mjs';
import { createReplenishmentOperations } from '../replenishment.mjs';
import { csvFixture } from './csv-fixture.mjs';

test('CSV -> strong product match -> live estimates, retries, correction and cancellation', async t => {
  assert(process.env.FIRESTORE_EMULATOR_HOST);
  const app = initializeApp({ projectId: 'demo-portal' }, 'replenishment-integration');
  const db = getFirestore(app); t.after(() => deleteApp(app));
  const uid = 'replenishment-owner', root = db.collection('users').doc(uid);
  const importCsv = createCsvImporter(db), operations = createReplenishmentOperations(db, () => new Date('2026-10-05T00:00:00Z'));
  const first = csvFixture('period-first');
  first.order.orderedOn = first.order.lines[0].orderedOn = '2026-08-01'; first.order.lines[0].orderDateEvidence = '2026-08-01T00:00:00Z';
  const second = csvFixture('period-second');
  second.order.externalOrderId = 'FAKE-SECOND';
  second.order.orderKey = identity('order', 'amazon', second.source.accountKey, second.order.externalOrderId);
  second.order.lines[0].orderKey = second.order.orderKey;
  second.order.lines[0].lineMatchKey = identity('amazon_csv_line_hint', second.order.orderKey, 'FAKE-SKU-0');
  second.order.orderedOn = second.order.lines[0].orderedOn = '2026-09-01'; second.order.lines[0].orderDateEvidence = '2026-09-01T00:00:00Z';
  const a = await importCsv(uid, first, 'first'), b = await importCsv(uid, second, 'second');
  const results = await Promise.all([operations.matchProducts(uid, 'match-a'), operations.matchProducts(uid, 'match-b')]);
  assert.equal(results.reduce((sum, r) => sum + r.createdProducts, 0), 1);
  assert.equal((await root.collection('products').get()).size, 1);
  const product = (await root.collection('products').get()).docs[0];
  assert.equal(product.data().replenishmentStatus, 'candidate');
  let estimates = await operations.getReplenishment(uid);
  assert.equal(estimates.items[0].calculation.medianIntervalDays, 31); assert(estimates.items[0].candidate.eligible);
  const audits = (await root.collection('auditLogs').get()).size;
  assert.equal((await operations.matchProducts(uid, 'repeat')).matchedLines, 0);
  assert.equal((await root.collection('auditLogs').get()).size, audits);
  await root.collection('purchaseLines').doc(a.lineIds[0]).update({ userOverrides: { productId: { value: null, observationId: 'explicit-unmatch' } } });
  await operations.matchProducts(uid, 'user-unmatch');
  estimates = await operations.getReplenishment(uid); assert.equal(estimates.items[0].calculation.intervalCount, 0);
  await root.collection('purchaseLines').doc(a.lineIds[0]).update({ userOverrides: {} });
  await root.collection('purchaseLines').doc(b.lineIds[0]).update({ status: 'cancelled' });
  estimates = await operations.getReplenishment(uid); assert(!estimates.items[0].candidate.eligible);
  assert.equal((await operations.getReplenishment('unrelated-owner')).items.length, 0);
  await assert.rejects(operations.matchProducts('../other', 'reject'), e => e.code === 'FORBIDDEN');
});

test('SKU target honors effective assignments, null exclusions and identity conflicts', async t => {
  assert(process.env.FIRESTORE_EMULATOR_HOST);
  const app = initializeApp({ projectId: 'demo-portal' }, 'sku-override-integration');
  const db = getFirestore(app); t.after(() => deleteApp(app));
  const operations = createReplenishmentOperations(db, () => new Date('2026-10-05T00:00:00Z'));
  const sku = 'amazon:fake-account:override-sku';
  const fixed = value => ({ productId: { value, observationId: 'explicit-match' } });
  async function seed(label, { overrides = ['product-p'], stored = null, productSku = null, reservedTo = null } = {}) {
    const uid = 'sku-override-' + label, root = db.collection('users').doc(uid);
    for (const pid of ['product-p', 'product-q']) await root.collection('products').doc(pid).set({ schemaVersion: 1, revision: 1, canonicalName: '架空商品', category: 'unknown', replenishmentStatus: 'active', decisionOrigin: 'user', fieldOrigins: {}, ...(pid === 'product-p' && productSku ? { identifiers: { merchantSku: productSku } } : {}) });
    for (const [i, value] of [...overrides, undefined].entries()) {
      await root.collection('purchaseOrders').doc(`order-${i}`).set({ schemaVersion: 1, revision: 1, status: 'ordered', identityStatus: 'confirmed', orderedOn: i ? '2026-09-01' : '2026-08-01', fieldOrigins: {} });
      await root.collection('purchaseLines').doc(`line-${i}`).set({ schemaVersion: 1, revision: 1, productId: i === 0 ? stored : null, rawProductName: '架空商品', sourceId: 'fake-source', orderId: `order-${i}`, identifiers: { merchantSku: sku }, status: 'ordered', fieldOrigins: {}, ...(value !== undefined ? { userOverrides: fixed(value) } : {}) });
    }
    const key = root.collection('identityKeys').doc(identity('product_identifier', 'merchantSku', sku));
    if (reservedTo) await key.set({ schemaVersion: 1, kind: 'product_identifier', target: { collection: 'products', id: reservedTo } });
    return { uid, root, key, pending: root.collection('purchaseLines').doc(`line-${overrides.length}`) };
  }
  await t.test('unique override uses existing product with no SKU, concurrent retries and future imports', async () => {
    const { uid, root, key, pending } = await seed('unique');
    const before = (await root.collection('purchaseLines').doc('line-0').get()).data();
    const results = await Promise.all([operations.matchProducts(uid, 'match-a'), operations.matchProducts(uid, 'match-b')]);
    assert.equal(results.reduce((sum, r) => sum + r.createdProducts, 0), 0);
    assert.equal(results.reduce((sum, r) => sum + r.matchedLines, 0), 1);
    assert.equal((await root.collection('products').get()).size, 2);
    assert.equal((await pending.get()).data().productId, 'product-p');
    assert.equal((await key.get()).data().target.id, 'product-p');
    assert.deepEqual((await root.collection('purchaseLines').doc('line-0').get()).data(), before);
    assert.equal((await root.collection('products').doc('product-p').get()).data().identifiers, undefined);
    const estimate = (await operations.getReplenishment(uid)).items.find(x => x.product.id === 'product-p');
    assert.equal(estimate.calculation.medianIntervalDays, 31);
    const count = (await root.collection('auditLogs').get()).size;
    assert.equal((await operations.matchProducts(uid, 'repeat')).matchedLines, 0);
    assert.equal((await root.collection('auditLogs').get()).size, count);
    await root.collection('purchaseLines').doc('future-line').set({ ...(await pending.get()).data(), productId: null, revision: 1 });
    assert.equal((await operations.matchProducts(uid, 'future')).matchedLines, 1);
    assert.equal((await root.collection('purchaseLines').doc('future-line').get()).data().productId, 'product-p');
  });
  await t.test('non-null override supersedes stored product value without mutating that line', async () => {
    const { uid, root, pending } = await seed('stored', { stored: 'product-q' });
    const result = await operations.matchProducts(uid, 'stored');
    assert.equal(result.createdProducts, 0); assert.equal(result.matchedLines, 1);
    assert.equal((await pending.get()).data().productId, 'product-p');
    assert.equal((await root.collection('purchaseLines').doc('line-0').get()).data().productId, 'product-q');
    assert.equal((await root.collection('purchaseLines').doc('line-0').get()).data().userOverrides.productId.value, 'product-p');
  });
  await t.test('explicit null excludes the line and its old product from target and cycle', async () => {
    const { uid, root, pending } = await seed('null', { overrides: [null], stored: 'product-p' });
    const result = await operations.matchProducts(uid, 'null');
    assert.equal(result.createdProducts, 1); assert.equal(result.matchedLines, 1);
    const assigned = (await pending.get()).data().productId;
    assert.notEqual(assigned, 'product-p');
    assert.equal((await root.collection('purchaseLines').doc('line-0').get()).data().userOverrides.productId.value, null);
    assert.equal((await operations.getReplenishment(uid)).items.find(x => x.product.id === assigned).calculation.purchaseCount, 1);
  });
  for (const [label, setup] of [
    ['multiple', { overrides: ['product-p', 'product-q'] }],
    ['reservation-conflict', { reservedTo: 'product-q' }],
    ['different-sku', { productSku: 'amazon:fake-account:different-sku' }],
    ['missing-target', { overrides: ['missing-product'] }],
  ]) await t.test(label + ' leaves SKU unresolved without writes', async () => {
    const { uid, root, pending, key } = await seed(label, setup);
    const previousKey = (await key.get()).exists ? (await key.get()).data() : null;
    const result = await operations.matchProducts(uid, label);
    assert.equal(result.needsReview, 1); assert.equal(result.createdProducts, 0); assert.equal(result.matchedLines, 0);
    assert.equal((await pending.get()).data().productId, null);
    assert.equal((await root.collection('products').get()).size, 2);
    assert.equal((await root.collection('auditLogs').get()).size, 0);
    const afterKey = await key.get(); assert.deepEqual(afterKey.exists ? afterKey.data() : null, previousKey);
  });
});
