import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createApplication } from '../application.mjs';
import { createFirestoreRepository } from '../firestore.mjs';
import { createReplenishmentOperations } from '../replenishment.mjs';
import { createConversationRepository, createConversationApplication } from '../conversation.mjs';
import { createCommerceTools, runCommerceConversation } from '../tools.mjs';

const clock = () => new Date('2026-10-05T00:00:00Z');
test('anonymous history -> candidates -> research recommendation, corrections, switching and retries', async t => {
  assert(process.env.FIRESTORE_EMULATOR_HOST);
  const firebase = initializeApp({ projectId: 'demo-portal' }, 'conversation-integration'); t.after(() => deleteApp(firebase));
  const db = getFirestore(firebase), uid = 'conversation-owner', user = db.collection('users').doc(uid);
  const repo = Object.assign(createFirestoreRepository(db), createReplenishmentOperations(db, clock), createConversationRepository(db, clock));
  const app = createApplication(repo, clock); Object.assign(app, createConversationApplication(app, repo, clock));
  const product = { schemaVersion: 1, revision: 1, canonicalName: '架空シャンプー', category: 'shampoo', replenishmentStatus: 'candidate', decisionOrigin: 'rule', fieldOrigins: {} };
  await user.collection('products').doc('shampoo-a').set(product);
  await user.collection('products').doc('shampoo-b').set({ ...product, canonicalName: '架空代替シャンプー' });
  for (const [i, orderedOn] of ['2026-08-01', '2026-09-01'].entries()) {
    await user.collection('purchaseOrders').doc(`order-${i}`).set({ schemaVersion: 1, revision: 1, orderedOn, identityStatus: 'confirmed', status: 'ordered', fieldOrigins: {} });
    await user.collection('purchaseLines').doc(`line-${i}`).set({ schemaVersion: 1, revision: 1, orderId: `order-${i}`, productId: 'shampoo-a', quantity: 1, status: 'ordered', fieldOrigins: {} });
  }
  const tools = createCommerceTools({ application: app, uid, requestId: 'conversation' });
  let step = 0, context, saved;
  const reply = await runCommerceConversation({ message: 'そろそろ買うものある？今の値段と代替品も教えて', tools, model: async ({ messages }) => {
    if (step++ === 0) return { toolCalls: [{ id: 'history', name: 'get_purchase_history', arguments: { productId: 'shampoo-a', limit: 1 } }] };
    if (step === 2) { assert.equal(messages.at(-1).result.items[0].order.orderedOn, '2026-09-01'); return { toolCalls: [{ id: 'candidates', name: 'get_replenishment_candidates', arguments: {} }] }; }
    if (step === 3) { assert.equal(messages.at(-1).result.items[0].product.id, 'shampoo-a'); return { toolCalls: [{ id: 'context', name: 'get_product_context', arguments: { productId: 'shampoo-a' } }] }; }
    if (step === 4) {
      context = messages.at(-1).result;
      saved = { clientMutationId: 'recommendation-a', productId: 'shampoo-a', contextFingerprint: context.contextFingerprint, rationale: '周期上の確認時期です。在庫は不明です。', recommendedProduct: { name: '架空シャンプー', url: 'https://example.invalid/shampoo-a' }, currentPrice: { amountMinor: 900, currency: 'JPY', sourceUrl: 'https://example.invalid/shampoo-a', observedAt: '2026-10-04T12:00:00.000Z' }, alternatives: [{ name: '架空代替品', url: 'https://example.invalid/shampoo-b', rationale: '代替候補。適合はユーザー確認が必要。', currentPrice: null }], aiModel: 'fixture-provider' };
      return { toolCalls: [{ id: 'save', name: 'save_recommendation', arguments: saved }] };
    }
    assert.equal(messages.at(-1).result.recommendation.currentPrice.amountMinor, 900);
    return { text: 'シャンプーが確認時期です。架空調査価格は900円、代替品の価格は不明です。' };
  } });
  assert.equal(reply.toolCallCount, 4);
  const repeats = await Promise.all([app.saveRecommendation(uid, saved, 'retry-a'), app.saveRecommendation(uid, saved, 'retry-b')]);
  assert.equal(repeats[0].recommendationId, repeats[1].recommendationId);
  assert.equal((await user.collection('recommendations').get()).size, 1);
  await assert.rejects(app.saveRecommendation(uid, { ...saved, rationale: 'changed' }), e => e.code === 'CONFLICT');
  // Stable context across elapsed calculation timestamps, separate from material updates.
  assert.equal((await app.getProductContext(uid, { productId: 'shampoo-a' })).contextFingerprint, context.contextFingerprint);
  const correction = { clientMutationId: 'date-correction', collection: 'purchaseOrders', id: 'order-1', field: 'orderedOn', action: 'set', value: '2026-09-05', expectedRevision: 1 };
  const fixes = await Promise.all([app.correctRecord(uid, correction, 'fix-a'), app.correctRecord(uid, correction, 'fix-b')]);
  assert.equal(fixes[0].observationId, fixes[1].observationId);
  assert.equal((await user.collection('purchaseOrders').doc('order-1').get()).data().orderedOn, '2026-09-01');
  assert.equal((await app.getPurchaseHistory(uid, { limit: 1 })).items[0].order.orderedOn, '2026-09-05');
  assert.equal((await repo.getReplenishment(uid)).items[0].calculation.medianIntervalDays, 35);
  await assert.rejects(app.correctRecord(uid, { ...correction, clientMutationId: 'stale-fix' }, 'req'), e => e.code === 'CONFLICT');
  await assert.rejects(app.saveRecommendation(uid, { ...saved, clientMutationId: 'stale-recommendation' }, 'req'), e => e.code === 'CONFLICT');
  // Existing saved result remains idempotent even after context changes.
  assert.equal((await app.saveRecommendation(uid, saved, 'retry')).recommendation.currentPrice.amountMinor, 900);
  await app.correctRecord(uid, { clientMutationId: 'release-date', collection: 'purchaseOrders', id: 'order-1', field: 'orderedOn', action: 'release', expectedRevision: 2 }, 'req');
  assert.equal((await app.getPurchaseHistory(uid, { limit: 1 })).items[0].order.orderedOn, '2026-09-01');
  await app.correctRecord(uid, { clientMutationId: 'unmatch', collection: 'purchaseLines', id: 'line-0', field: 'productId', action: 'set', value: null, expectedRevision: 1 }, 'req');
  assert.equal((await repo.getReplenishment(uid)).items[0].calculation.intervalCount, 0);
  assert.equal((await app.getPurchaseHistory(uid, {})).items.find(x => x.line.id === 'line-0').line.matchMethod, 'user');
  await app.recordUsage(uid, { clientMutationId: 'use-a', productId: 'shampoo-a', value: 'current', expectedRevision: 0 }, 'req');
  const stateA = await app.recordState(uid, { clientMutationId: 'empty-a', productId: 'shampoo-a', kind: 'state', value: 'out_of_stock' }, 'req');
  assert.equal(stateA.effectiveState.usage, 'current');
  assert.equal((await app.getReplenishment(uid, {})).items[0].product.id, 'shampoo-a');
  const useB = { clientMutationId: 'use-b', productId: 'shampoo-b', value: 'current', expectedRevision: 0 };
  const switched = await Promise.all([app.recordUsage(uid, useB, 'req'), app.recordUsage(uid, useB, 'retry')]);
  assert.deepEqual(switched[0].switchedProductIds, ['shampoo-a']);
  const oldState = (await user.collection('productStates').doc('shampoo-a').get()).data();
  assert.equal(oldState.usage, 'not_current');
  assert.equal((await user.collection('userObservations').doc(oldState.usageObservationId).get()).data().productId, 'shampoo-a');
  assert.equal((await user.collection('productStates').doc('shampoo-a').get()).data().state, 'out_of_stock');
  const current = await app.getCurrentProduct(uid, { category: 'shampoo' }); assert.equal(current.origin, 'user'); assert.equal(current.items[0].product.id, 'shampoo-b');
  assert.equal((await app.getReplenishment(uid, {})).items.length, 0);
  await assert.rejects(app.recordUsage(uid, { ...useB, clientMutationId: 'stale-use' }, 'req'), e => e.code === 'CONFLICT');
  const audits = (await user.collection('auditLogs').get()).docs.map(d => d.data());
  const dateAudit = audits.find(a => a.observationId === fixes[0].observationId);
  assert.equal(dateAudit.actor, 'user'); assert(dateAudit.changes.some(c => c.field === 'userOverrides' && c.after.orderedOn.value === '2026-09-05'));
  assert.equal(audits.filter(a => a.target.collection === 'recommendations').length, 1);
  await assert.rejects(app.getProductContext('unrelated-user', { productId: 'shampoo-a' }), e => e.code === 'NOT_FOUND');
  await assert.rejects(app.correctRecord('unrelated-user', { ...correction, clientMutationId: 'other-fix' }, 'req'), e => e.code === 'NOT_FOUND');
  await assert.rejects(repo.readConversationSnapshot('../other'), e => e.code === 'FORBIDDEN');
});

test('recommendation tool acknowledges a committed maximum-size history snapshot and retries', async t => {
  assert(process.env.FIRESTORE_EMULATOR_HOST);
  const firebase = initializeApp({ projectId: 'demo-portal' }, 'recommendation-large-context');
  t.after(() => deleteApp(firebase));
  const db = getFirestore(firebase), uid = 'large-recommendation-owner';
  const user = db.collection('users').doc(uid);
  const repo = Object.assign(createFirestoreRepository(db), createReplenishmentOperations(db, clock), createConversationRepository(db, clock));
  const app = createApplication(repo, clock);
  Object.assign(app, createConversationApplication(app, repo, clock));
  await user.collection('products').doc('product').set({ canonicalName: 'Fixture', category: 'unknown', replenishmentStatus: 'candidate', revision: 1 });
  await user.collection('purchaseOrders').doc('order').set({ orderedOn: '2026-09-01', identityStatus: 'confirmed', status: 'ordered', revision: 1 });
  // 5000 is the supported collection maximum; all IDs obey the 128-char ID
  // validator. No oversized request or unsupported document shape is needed.
  for (let start = 0; start < 5000; start += 500) {
    const batch = db.batch();
    for (let i = start; i < start + 500; i++) {
      const lineId = String(i).padStart(64, '0');
      batch.set(user.collection('purchaseLines').doc(lineId), { orderId: 'order', productId: 'product', status: 'ordered', revision: 1 });
    }
    await batch.commit();
  }
  const context = await app.getProductContext(uid, { productId: 'product' });
  assert.equal(context.calculation.inputLineIds.length, 5000);
  assert(JSON.stringify(context).length > 256 * 1024);
  const input = { clientMutationId: 'large-snapshot', productId: 'product', contextFingerprint: context.contextFingerprint, rationale: 'Fixture research', recommendedProduct: { name: 'Fixture' }, alternatives: [], currentPrice: null };
  const tools = createCommerceTools({ application: app, uid, requestId: 'large-context' });
  const receipt = await tools.execute('save_recommendation', input);
  assert.deepEqual(Object.keys(receipt), ['recommendationId']);
  const stored = await user.collection('recommendations').doc(receipt.recommendationId).get();
  assert(stored.exists);
  assert.equal(stored.data().context.calculation.inputLineIds.length, 5000);
  assert.deepEqual(await tools.execute('save_recommendation', input), receipt);
  assert.equal((await user.collection('recommendations').get()).size, 1);
  const audits = (await user.collection('auditLogs').get()).docs;
  assert.equal(audits.filter(d => d.data().target.collection === 'recommendations').length, 1);
  // Direct API callers retain the complete original snapshot contract.
  const direct = await app.saveRecommendation(uid, input, 'direct-retry');
  assert.equal(direct.recommendationId, receipt.recommendationId);
  assert(JSON.stringify(direct).length > 256 * 1024);
});
