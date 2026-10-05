import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError, effective, id } from './application.mjs';
import { identity } from './amazon-csv.mjs';

const dayMs = 86400000;
const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const shift = (day, days) => new Date(Date.parse(day) + days * dayMs).toISOString().slice(0, 10);
export const jstDay = time => new Date(time.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = value => value?.toDate?.().toISOString() ?? (typeof value === 'string' ? value : null);

export function calculateReplenishment({ orders, lines, products, states }, now = new Date()) {
  const asOf = jstDay(now), clock = now.toISOString();
  const orderMap = new Map(orders.map(o => [o.id, effective(o)]));
  const productMap = new Map(products.map(p => [p.id, effective(p)]));
  const stateMap = new Map(states.map(s => [s.id, s]));
  const valid = lines.map(effective).filter(l => {
    const o = orderMap.get(l.orderId);
    return o?.identityStatus === 'confirmed' && o.status === 'ordered' && validDay(o.orderedOn) && o.orderedOn <= asOf && l.status === 'ordered' && productMap.has(l.productId);
  }).map(l => ({ line: l, order: orderMap.get(l.orderId), product: productMap.get(l.productId) }));
  const results = [];
  for (const product of productMap.values()) {
    const own = valid.filter(x => x.line.productId === product.id);
    const category = product.category && product.category !== 'unknown' ? valid.filter(x => x.product.category === product.category) : [];
    const dates = xs => [...new Set(xs.map(x => x.order.orderedOn))].sort();
    let inputs = own, days = dates(own), basis = days.length >= 2 ? 'product' : 'none';
    if (basis === 'none' && dates(category).length >= 2) { inputs = category; days = dates(category); basis = 'category'; }
    const intervals = days.slice(1).map((d, i) => (Date.parse(d) - Date.parse(days[i])) / dayMs);
    const sorted = [...intervals].sort((a, b) => a - b);
    const average = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
    const median = intervals.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
    const last = days.at(-1) ?? null;
    const next = median === null ? null : shift(last, Math.round(median));
    const notifyFrom = next === null ? null : shift(next, -7);
    const confidence = !intervals.length ? 'insufficient' : basis === 'product' && intervals.length >= 2 && Math.abs(average - median) <= median * 0.5 ? 'medium' : 'low';
    const state = stateMap.get(product.id) ?? { state: 'unknown', origin: 'unknown', usage: 'unknown', usageOrigin: 'unknown', suppressUntil: null };
    const reasonCodes = [];
    let eligible = true;
    if (!['active', 'candidate'].includes(product.replenishmentStatus)) { eligible = false; reasonCodes.push('not_replenishment_target'); }
    if (state.usage === 'not_current') { eligible = false; reasonCodes.push('not_current'); }
    // A newer purchase of another product in a known category supersedes inferred use.
    const ownLast = dates(own).at(-1), categoryLast = dates(category).at(-1);
    if (!(state.usage === 'current' && state.usageOrigin === 'user') && ownLast && categoryLast && categoryLast > ownLast) { eligible = false; reasonCodes.push('newer_category_product'); }
    const suppressUntil = iso(state.suppressUntil);
    const suppressed = state.origin === 'user' && ['likely_available', 'spare_available'].includes(state.state) && suppressUntil && Date.parse(suppressUntil) > now.getTime();
    if (suppressed) { eligible = false; reasonCodes.push('user_suppressed'); }
    const explicitEmpty = state.origin === 'user' && state.state === 'out_of_stock' && state.usage === 'current' && state.usageOrigin === 'user';
    if (!explicitEmpty && (notifyFrom === null || asOf < notifyFrom)) { eligible = false; reasonCodes.push(notifyFrom === null ? 'insufficient_history' : 'not_due'); }
    if (eligible) reasonCodes.push(explicitEmpty ? 'user_out_of_stock' : 'cycle_due');
    if (state.origin === 'user' && ['likely_available', 'spare_available'].includes(state.state) && !suppressed) reasonCodes.push('past_available_observation');
    const fingerprintInput = { methodVersion: 'interval-v1', category: product.category, inputs: inputs.map(x => [x.line.id, x.line.revision ?? null, x.line.productId, x.line.status, x.order.id, x.order.revision ?? null, x.order.orderedOn, x.order.status, x.order.identityStatus]).sort((a, b) => a[0] < b[0] ? -1 : 1) };
    results.push({ product, state, calculation: { basis, methodVersion: 'interval-v1', purchaseCount: days.length, intervalCount: intervals.length, inputLineIds: inputs.map(x => x.line.id).sort(), inputFingerprint: hash(fingerprintInput), averageIntervalDays: average, medianIntervalDays: median, lastPurchasedOn: last, calculatedAt: clock }, prediction: { estimatedNextPurchaseOn: next, notifyFrom, confidence, reasonCodes: basis === 'none' ? ['insufficient_history'] : basis === 'category' ? ['category_fallback'] : intervals.length < 2 ? ['single_interval'] : ['product_intervals'] }, candidate: { eligible, reasonCodes, evaluatedAt: clock } });
  }
  return { asOf, items: results.sort((a, b) => a.product.id.localeCompare(b.product.id)) };
}

export function createReplenishmentOperations(db, now = () => new Date()) {
  const root = uid => { if (typeof uid !== 'string' || !uid || uid.includes('/') || uid.length > 128 || ['.', '..'].includes(uid)) throw new AppError('FORBIDDEN', 'Invalid authenticated uid', 403); return db.collection('users').doc(uid); };
  async function read(tx, user, name, limit = 5000) {
    const snap = await tx.get(user.collection(name).limit(limit + 1));
    if (snap.size > limit) throw new AppError('RESOURCE_EXHAUSTED', 'Personal-scale calculation limit exceeded', 413);
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  }
  return {
    async getReplenishment(uid) {
      const user = root(uid), clock = now();
      // One read transaction gives all inputs a consistent snapshot. No cached projection.
      return db.runTransaction(async tx => {
        const [orders, lines, products, states] = await Promise.all(['purchaseOrders', 'purchaseLines', 'products', 'productStates'].map(n => read(tx, user, n)));
        return calculateReplenishment({ orders, lines, products, states }, clock);
      }, { readOnly: true });
    },
    async matchProducts(uid, requestId) {
      const user = root(uid);
      const lines = await db.runTransaction(tx => read(tx, user, 'purchaseLines'), { readOnly: true });
      const skus = [...new Set(lines.map(l => l.identifiers?.merchantSku).filter(s => typeof s === 'string' && s.length <= 300))].sort();
      const counts = { processed: 0, matchedLines: 0, createdProducts: 0, needsReview: 0 };
      for (const sku of skus) {
        const key = user.collection('identityKeys').doc(identity('product_identifier', 'merchantSku', sku));
        const outcome = await db.runTransaction(async tx => {
          const [keySnap, candidates, lineSnap] = await Promise.all([tx.get(key), tx.get(user.collection('products').where('identifiers.merchantSku', '==', sku).limit(3)), tx.get(user.collection('purchaseLines').where('identifiers.merchantSku', '==', sku).limit(101))]);
          if (candidates.size > 1 || lineSnap.size > 100) return { review: true };
          // Explicit assignments participate in identity resolution; explicit null does not.
          const ids = new Set(lineSnap.docs.map(d => effective(d.data()).productId).filter(Boolean));
          if (ids.size > 1) return { review: true };
          const target = keySnap.exists ? keySnap.data().target : candidates.size ? { collection: 'products', id: candidates.docs[0].id } : ids.size ? { collection: 'products', id: [...ids][0] } : null;
          if (target && target.collection !== 'products') throw new AppError('CONFLICT', 'Product identity conflict', 409);
          if (ids.size && (!target || [...ids].some(x => x !== target.id))) return { review: true };
          const productRef = user.collection('products').doc(target ? id(target.id) : randomUUID());
          const productSnap = await tx.get(productRef);
          if (target && !productSnap.exists) return { review: true };
          // A user-selected product may have no SKU metadata. Reserve the SKU to it
          // without replacing its identifiers. An already different SKU is a conflict.
          const productSku = productSnap.exists ? productSnap.data().identifiers?.merchantSku : null;
          if (productSku && productSku !== sku) return { review: true };
          if (candidates.size && candidates.docs[0].id !== productRef.id) return { review: true };
          const pending = lineSnap.docs.filter(d => !d.data().productId && !Object.hasOwn(d.data().userOverrides ?? {}, 'productId') && typeof d.data().rawProductName === 'string');
          if (!pending.length && !productSnap.exists) return { matched: 0, created: false };
          const orderRefs = [...new Set(lineSnap.docs.map(d => d.data().orderId))].map(x => user.collection('purchaseOrders').doc(id(x)));
          const orderSnaps = await Promise.all(orderRefs.map(r => tx.get(r)));
          const orderMap = new Map(orderSnaps.filter(s => s.exists).map(s => [s.id, effective(s.data())]));
          const days = new Set(lineSnap.docs.map(d => { const raw = d.data(), l = effective(raw), o = orderMap.get(l.orderId); if (Object.hasOwn(raw.userOverrides ?? {}, 'productId') && l.productId !== productRef.id) return null; return l.status === 'ordered' && o?.status === 'ordered' && o.identityStatus === 'confirmed' && validDay(o.orderedOn) && o.orderedOn <= jstDay(now()) ? o.orderedOn : null; }).filter(Boolean));
          const clock = Timestamp.fromDate(now()), previous = productSnap.exists ? productSnap.data() : null;
          const promotion = previous && previous.replenishmentStatus === 'unknown' && ['unknown', 'rule'].includes(previous.decisionOrigin) && !Object.hasOwn(previous.userOverrides ?? {}, 'replenishmentStatus') && days.size >= 2;
          const after = previous ? promotion ? { ...previous, replenishmentStatus: 'candidate', decisionOrigin: 'rule', revision: (previous.revision ?? 0) + 1, updatedAt: clock, fieldOrigins: { ...previous.fieldOrigins, replenishmentStatus: { kind: 'rule', methodVersion: 'repeat-v1' } } } : previous : { schemaVersion: 1, revision: 1, createdAt: clock, updatedAt: clock, canonicalName: pending[0].data().rawProductName, aliases: [], category: 'unknown', brand: null, sizeValue: null, sizeUnit: null, packageType: null, packCount: null, identifiers: { merchantSku: sku }, replenishmentStatus: days.size >= 2 ? 'candidate' : 'unknown', decisionOrigin: days.size >= 2 ? 'rule' : 'unknown', fieldOrigins: { canonicalName: { kind: 'source', sourceId: pending[0].data().sourceId }, replenishmentStatus: { kind: 'rule', methodVersion: 'repeat-v1' } } };
          function audit(ref, before, fields, action) {
            tx.create(user.collection('auditLogs').doc(randomUUID()), { schemaVersion: 1, createdAt: clock, recordedAt: clock, requestId, actor: 'application', action, target: { collection: ref.parent.id, id: ref.id }, methodVersion: 'sku-match-v1', changes: Object.keys(fields).filter(k => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(fields[k])).map(field => ({ field, before: before?.[field] ?? null, after: fields[field] })) });
          }
          if (!previous || promotion) { tx.set(productRef, after); audit(productRef, previous, after, previous ? 'merge' : 'create'); }
          if (!keySnap.exists) tx.create(key, { kind: 'product_identifier', schemaVersion: 1, target: { collection: 'products', id: productRef.id }, createdAt: clock });
          for (const d of pending) {
            const before = d.data();
            const fields = { productId: productRef.id, matchMethod: 'identifier', revision: (before.revision ?? 0) + 1, updatedAt: clock, fieldOrigins: { ...before.fieldOrigins, productId: { kind: 'rule', methodVersion: 'sku-match-v1' } } };
            tx.update(d.ref, fields); audit(d.ref, before, fields, 'merge');
          }
          return { matched: pending.length, created: !previous };
        });
        counts.processed++; counts.matchedLines += outcome.matched ?? 0; counts.createdProducts += outcome.created ? 1 : 0; counts.needsReview += outcome.review ? 1 : 0;
      }
      return counts;
    },
  };
}
