import { createHash } from 'node:crypto';
import { AppError, effective, id, invalid } from './application.mjs';
import { serialize } from './firestore.mjs';
import { Timestamp } from 'firebase-admin/firestore';
import { calculateReplenishment } from './replenishment.mjs';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const fingerprint = v => createHash('sha256').update(JSON.stringify(canonical(serialize(v)))).digest('hex');
const fail = (code, message, status) => new AppError(code, message, status);
function object(v, fields) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !fields.includes(k))) throw invalid('Unknown or invalid input field');
}
function text(v, max = 500) { if (typeof v !== 'string' || !v.trim() || v.length > max) throw invalid('Invalid text'); return v; }
function revision(v) { if (!Number.isSafeInteger(v) || v < 0) throw invalid('Invalid expectedRevision'); }
function day(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw invalid('Invalid date'); }
function url(v) { let u; try { u = new URL(v); } catch { throw invalid('Invalid source URL'); } if (u.protocol !== 'https:' || u.username || u.password || typeof v !== 'string' || v.length > 2048) throw invalid('HTTPS source URL required'); }
function price(v, now) {
  if (v === null) return;
  object(v, ['amountMinor', 'currency', 'sourceUrl', 'observedAt']);
  if (!Number.isSafeInteger(v.amountMinor) || v.amountMinor < 0 || !/^[A-Z]{3}$/.test(v.currency)) throw invalid('Invalid price');
  url(v.sourceUrl);
  // Require canonical UTC times; do not silently normalize invalid calendar dates.
  if (typeof v.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.observedAt) || !Number.isFinite(Date.parse(v.observedAt)) || new Date(v.observedAt).toISOString() !== v.observedAt || Date.parse(v.observedAt) > now.getTime()) throw invalid('Invalid price observedAt');
}
export function contextItem(item) {
  const { calculatedAt, ...calculation } = item.calculation;
  const { evaluatedAt, ...candidate } = item.candidate;
  return { ...serialize(item), contextFingerprint: fingerprint({ product: item.product, state: item.state, calculation, prediction: item.prediction, candidate }) };
}
export function createConversationApplication(application, repository, now = () => new Date()) {
  return {
    async getProductContext(uid, input) {
      object(input, ['productId']); id(input.productId);
      const all = await repository.getReplenishment(uid), item = all.items.find(x => x.product.id === input.productId);
      if (!item) throw fail('NOT_FOUND', 'Product not found', 404);
      return { asOf: all.asOf, ...contextItem(item) };
    },
    async getCurrentProduct(uid, input) {
      object(input, ['category']); text(input.category, 100);
      const history = await repository.readConversationSnapshot(uid);
      const all = calculateReplenishment(history, now()), items = all.items.filter(x => x.product.category === input.category).map(contextItem);
      const explicit = items.filter(x => x.state.usageOrigin === 'user' && x.state.usage === 'current');
      const orders = new Map(history.orders.map(o => [o.id, effective(o)]));
      const lastByProduct = new Map();
      for (const line of history.lines.map(effective)) {
        const order = orders.get(line.orderId);
        if (!order || order.identityStatus !== 'confirmed' || order.status !== 'ordered' || line.status !== 'ordered' || typeof order.orderedOn !== 'string' || order.orderedOn > all.asOf) continue;
        if (!lastByProduct.has(line.productId) || lastByProduct.get(line.productId) < order.orderedOn) lastByProduct.set(line.productId, order.orderedOn);
      }
      const available = items.filter(x => x.state.usage !== 'not_current' && lastByProduct.has(x.product.id));
      const latest = available.map(x => lastByProduct.get(x.product.id)).sort().at(-1);
      const inferred = input.category === 'unknown' ? [] : available.filter(x => lastByProduct.get(x.product.id) === latest);
      const selected = explicit.length ? explicit : inferred;
      return { asOf: all.asOf, category: input.category, origin: explicit.length ? 'user' : inferred.length ? 'inference' : 'unknown', ambiguous: selected.length !== 1, items: selected, context: items };
    },
    async correctRecord(uid, input, requestId) {
      object(input, ['clientMutationId', 'collection', 'id', 'field', 'value', 'action', 'expectedRevision']);
      id(input.clientMutationId); id(input.id); revision(input.expectedRevision);
      const fields = { purchaseOrders: ['orderedOn', 'status'], purchaseLines: ['productId', 'quantity', 'status'], products: ['canonicalName', 'category', 'replenishmentStatus'] };
      if (!Object.hasOwn(fields, input.collection) || !fields[input.collection].includes(input.field) || !['set', 'release'].includes(input.action)) throw invalid('Unsupported correction');
      if (input.action === 'release') { if (Object.hasOwn(input, 'value')) throw invalid('Release has no value'); }
      else {
        if (!Object.hasOwn(input, 'value')) throw invalid('Correction value required');
        const v = input.value;
        if (input.field === 'orderedOn') day(v);
        if (input.field === 'status' && !['ordered', 'cancelled', 'returned', 'unknown'].includes(v)) throw invalid('Invalid status');
        if (input.field === 'productId' && v !== null) id(v);
        if (input.field === 'quantity' && v !== null && (!Number.isSafeInteger(v) || v <= 0)) throw invalid('Invalid quantity');
        if (['canonicalName', 'category'].includes(input.field)) text(v, input.field === 'category' ? 100 : 500);
        if (input.field === 'replenishmentStatus' && !['unknown', 'candidate', 'active', 'excluded'].includes(v)) throw invalid('Invalid replenishment status');
      }
      return repository.correctRecord(uid, input, requestId);
    },
    async recordUsage(uid, input, requestId) {
      object(input, ['clientMutationId', 'productId', 'value', 'expectedRevision']);
      id(input.clientMutationId); id(input.productId); revision(input.expectedRevision);
      if (!['unknown', 'current', 'not_current'].includes(input.value)) throw invalid('Invalid usage');
      return repository.recordUsage(uid, input, requestId);
    },
    async saveRecommendation(uid, input, requestId) {
      object(input, ['clientMutationId', 'productId', 'contextFingerprint', 'rationale', 'recommendedProduct', 'alternatives', 'currentPrice', 'aiModel']);
      id(input.clientMutationId); id(input.productId); text(input.rationale, 2000);
      if (typeof input.contextFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.contextFingerprint)) throw invalid('Invalid context fingerprint');
      object(input.recommendedProduct, ['name', 'url']); text(input.recommendedProduct.name, 500);
      if (input.recommendedProduct.url !== undefined) url(input.recommendedProduct.url);
      if (!Array.isArray(input.alternatives) || input.alternatives.length > 5) throw invalid('Invalid alternatives');
      for (const a of input.alternatives) { object(a, ['name', 'url', 'rationale', 'currentPrice']); text(a.name); text(a.rationale, 1000); url(a.url); price(a.currentPrice, now()); }
      price(input.currentPrice, now());
      if (input.aiModel !== undefined) text(input.aiModel, 100);
      return repository.saveRecommendation(uid, input, requestId);
    },
  };
}

export function createConversationRepository(db, now = () => new Date()) {
  const root = uid => { if (typeof uid !== 'string' || !uid || uid.includes('/') || uid.length > 128 || ['.', '..'].includes(uid)) throw fail('FORBIDDEN', 'Invalid authenticated uid', 403); return db.collection('users').doc(uid); };
  async function read(tx, user, name) {
    const s = await tx.get(user.collection(name).limit(5001));
    if (s.size > 5000) throw fail('RESOURCE_EXHAUSTED', 'Personal-scale context limit exceeded', 413);
    return s.docs.map(d => ({ ...d.data(), id: d.id }));
  }
  function audit(tx, user, target, before, after, observationId, requestId, clock, actor, action) {
    const changes = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].flatMap(field => {
      const a = serialize(before?.[field] ?? null), b = serialize(after[field] ?? null);
      return fingerprint(a) === fingerprint(b) ? [] : [{ field, before: a, after: b }];
    });
    tx.create(user.collection('auditLogs').doc(fingerprint([observationId, target])), { schemaVersion: 1, createdAt: clock, recordedAt: clock, actor, action, target, observationId, requestId, changes });
  }
  async function mutation(uid, input, requestId, apply) {
    const user = root(uid), observationId = createHash('sha256').update(JSON.stringify(['v1', input.clientMutationId])).digest('hex');
    const ref = user.collection('userObservations').doc(observationId), inputFingerprint = fingerprint(input), clock = Timestamp.fromDate(now());
    return db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists) { if (previous.data().inputFingerprint !== inputFingerprint) throw fail('CONFLICT', 'Mutation ID reused', 409); return previous.data().result; }
      const result = await apply(tx, user, observationId, clock);
      tx.create(ref, { schemaVersion: 1, createdAt: clock, recordedAt: clock, observedAt: clock, source: 'user', clientMutationId: input.clientMutationId, inputFingerprint, ...input, kind: input.collection ? (input.action === 'release' ? 'release' : 'correction') : 'usage', target: { collection: input.collection ?? 'products', id: input.id ?? input.productId }, result });
      return result;
    });
  }
  return {
    async readConversationSnapshot(uid) {
      const user = root(uid);
      return db.runTransaction(async tx => {
        const [orders, lines, products, states] = await Promise.all(['purchaseOrders', 'purchaseLines', 'products', 'productStates'].map(n => read(tx, user, n)));
        return { orders, lines, products, states };
      }, { readOnly: true });
    },
    async correctRecord(uid, input, requestId) {
      return mutation(uid, input, requestId, async (tx, user, oid, clock) => {
        const ref = user.collection(input.collection).doc(input.id), snap = await tx.get(ref);
        if (!snap.exists) throw fail('NOT_FOUND', 'Correction target not found', 404);
        const before = snap.data();
        if ((before.revision ?? 0) !== input.expectedRevision) throw fail('CONFLICT', 'Revision changed; read context again', 409);
        if (input.field === 'productId' && input.action === 'set' && input.value !== null && !(await tx.get(user.collection('products').doc(input.value))).exists) throw fail('NOT_FOUND', 'Product not found', 404);
        const overrides = { ...before.userOverrides };
        if (input.action === 'release') { if (!Object.hasOwn(overrides, input.field)) throw fail('CONFLICT', 'No override to release', 409); delete overrides[input.field]; }
        else overrides[input.field] = { value: input.value, observationId: oid };
        const after = { ...before, userOverrides: overrides, revision: (before.revision ?? 0) + 1, updatedAt: clock };
        tx.set(ref, after);
        audit(tx, user, { collection: input.collection, id: input.id }, before, after, oid, requestId, clock, 'user', input.action === 'release' ? 'release' : 'correct');
        return serialize({ observationId: oid, record: { ...effective(after), id: input.id }, revision: after.revision });
      });
    },
    async recordUsage(uid, input, requestId) {
      return mutation(uid, input, requestId, async (tx, user, oid, clock) => {
        const products = await read(tx, user, 'products'), states = await read(tx, user, 'productStates');
        const product = products.map(effective).find(p => p.id === input.productId);
        if (!product) throw fail('NOT_FOUND', 'Product not found', 404);
        const beforeState = states.find(s => s.id === input.productId);
        if ((beforeState?.revision ?? 0) !== input.expectedRevision) throw fail('CONFLICT', 'Revision changed; read context again', 409);
        const knownCategory = product.category && product.category !== 'unknown';
        const previous = input.value === 'current' && knownCategory ? products.map(effective).filter(p => p.id !== product.id && p.category === product.category && states.some(s => s.id === p.id && s.usage === 'current')).map(p => p.id) : [];
        if (previous.length > 100) throw fail('RESOURCE_EXHAUSTED', 'Too many current products to switch atomically', 413);
        for (const pid of [...previous, product.id]) {
          const before = states.find(s => s.id === pid), value = pid === product.id ? input.value : 'not_current';
          const after = { state: 'unknown', origin: 'unknown', observedAt: null, observationId: null, suppressUntil: null, ...before, schemaVersion: 1, createdAt: before?.createdAt ?? clock, updatedAt: clock, revision: (before?.revision ?? 0) + 1, usage: value, usageOrigin: value === 'unknown' ? 'unknown' : 'user', usageObservationId: oid, usageObservedAt: clock, usageRecordedAt: clock };
          delete after.id;
          tx.set(user.collection('productStates').doc(pid), after);
          audit(tx, user, { collection: 'productStates', id: pid }, before ? Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'id')) : null, after, oid, requestId, clock, 'user', 'observe');
          // Each switched product gets its own observation in the same transaction.
          if (pid !== product.id) tx.create(user.collection('userObservations').doc(fingerprint([oid, pid])), { schemaVersion: 1, createdAt: clock, recordedAt: clock, observedAt: clock, source: 'user', kind: 'usage', productId: pid, value, parentObservationId: oid, target: { collection: 'products', id: pid } });
        }
        return { observationId: oid, productId: product.id, usage: input.value, revision: input.expectedRevision + 1, switchedProductIds: previous };
      });
    },
    async saveRecommendation(uid, input, requestId) {
      const user = root(uid), recommendationId = fingerprint(['recommendation-v1', input.clientMutationId]), ref = user.collection('recommendations').doc(recommendationId), inputFingerprint = fingerprint(input), clock = Timestamp.fromDate(now());
      return db.runTransaction(async tx => {
        const previous = await tx.get(ref);
        if (previous.exists) { if (previous.data().inputFingerprint !== inputFingerprint) throw fail('CONFLICT', 'Mutation ID reused', 409); return serialize({ recommendationId, recommendation: previous.data() }); }
        const [orders, lines, products, states] = await Promise.all(['purchaseOrders', 'purchaseLines', 'products', 'productStates'].map(n => read(tx, user, n)));
        const item = calculateReplenishment({ orders, lines, products, states }, clock.toDate()).items.find(x => x.product.id === input.productId);
        if (!item) throw fail('NOT_FOUND', 'Product not found', 404);
        const context = contextItem(item);
        if (context.contextFingerprint !== input.contextFingerprint) throw fail('CONFLICT', 'Recommendation context changed; read again', 409);
        const storedPrice = p => p === null ? null : { ...p, observedAt: Timestamp.fromDate(new Date(p.observedAt)) };
        const data = { schemaVersion: 1, createdAt: clock, generatedAt: clock, ...input, currentPrice: storedPrice(input.currentPrice), alternatives: input.alternatives.map(a => ({ ...a, currentPrice: storedPrice(a.currentPrice) })), inputFingerprint, context };
        tx.create(ref, data);
        audit(tx, user, { collection: 'recommendations', id: recommendationId }, null, data, recommendationId, requestId, clock, 'ai', 'create');
        return serialize({ recommendationId, recommendation: data });
      });
    },
  };
}
