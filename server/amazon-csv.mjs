import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError, invalid, id } from './application.mjs';
import { serialize } from './firestore.mjs';

const files = ['Your Amazon Orders/Order History.csv', 'Your Returns & Refunds/Refund Details.csv', 'Your Returns & Refunds/Returns Status.csv', 'Your Returns & Refunds/Replacement Orders.csv'];
export const identity = (...parts) => createHash('sha256').update(JSON.stringify(['v1', ...parts])).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const reasons = ['invalid_order_date', 'zero_quantity', 'invalid_quantity', 'missing_product', 'ambiguous_same_asin_rows', 'missing_return_or_replacement_files', 'return_or_refund_requires_review', 'replacement_not_purchase', 'cancelled', 'unconfirmed_order_or_shipment', 'unsupported_currency', 'inconsistent_order_dates'];
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw invalid('Invalid CSV proposal fields');
}
function string(value, max = 128) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max) throw invalid('Invalid CSV string');
  return value;
}
function nullableString(value, max) { return value === null ? null : string(value, max); }
function date(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw invalid('Invalid CSV date');
  return value;
}
function array(value, max) { if (!Array.isArray(value) || value.length > max) throw invalid('Invalid CSV array'); return value; }
function origins(value, fields, sourceId) {
  object(value, fields);
  for (const field of fields) {
    object(value[field], ['kind', 'sourceId']);
    if (value[field].kind !== 'source' || value[field].sourceId !== sourceId) throw invalid('Invalid CSV origin');
  }
}
export function validateProposal(body) {
  object(body, ['contractVersion', 'importBatchKey', 'source', 'order']);
  if (body.contractVersion !== 'amazon-csv-v1') throw invalid('Unsupported CSV contract');
  const s = body.source;
  object(s, ['provider', 'accountKey', 'sourceId', 'fileHashes', 'extractionVersion']);
  const account = id(s.accountKey, 'accountKey');
  if (s.provider !== 'amazon_csv' || s.extractionVersion !== body.contractVersion) throw invalid('Invalid CSV source');
  object(s.fileHashes, files);
  for (const value of Object.values(s.fileHashes)) if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw invalid('Invalid CSV hash');
  const sourceId = identity('amazon_csv', account, s.fileHashes[files[0]]);
  const batch = identity('amazon_csv_batch', account, Object.entries(s.fileHashes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  if (!s.fileHashes[files[0]] || s.sourceId !== sourceId || body.importBatchKey !== batch) throw invalid('Invalid CSV identity');
  const o = body.order;
  object(o, ['orderKey', 'merchant', 'merchantAccountKey', 'externalOrderId', 'orderedOn', 'dateTimezone', 'orderDateBasis', 'sourceId', 'identityStatus', 'status', 'fieldOrigins', 'replacementOfOrderKeys', 'lines']);
  string(o.externalOrderId);
  if (o.orderKey !== identity('order', 'amazon', account, o.externalOrderId) || o.merchant !== 'amazon' || o.merchantAccountKey !== account || o.sourceId !== sourceId || o.identityStatus !== 'confirmed' || o.dateTimezone !== 'Asia/Tokyo' || o.orderDateBasis !== 'csv_order_date') throw invalid('Invalid CSV order');
  date(o.orderedOn); origins(o.fieldOrigins, ['orderedOn'], sourceId);
  if (!['ordered', 'cancelled', 'unknown'].includes(o.status)) throw invalid('Invalid CSV status');
  array(o.replacementOfOrderKeys, 50).forEach(x => { if (typeof x !== 'string' || !/^[a-f0-9]{64}$/.test(x)) throw invalid('Invalid replacement reference'); });
  if (!array(o.lines, 50).length) throw invalid('CSV order must contain lines');
  const refs = new Set();
  for (const l of o.lines) {
    object(l, ['sourceLineRef', 'orderKey', 'sourceId', 'orderedOn', 'rawProductName', 'quantity', 'amountMinor', 'currency', 'status', 'disposition', 'reasonCodes', 'warnings', 'productId', 'matchMethod', 'identifiers', 'lineMatchKey', 'fieldOrigins', 'orderDateEvidence', 'cycleEligibleAfterProductMatch']);
    if (typeof l.sourceLineRef !== 'string' || !/^Your Amazon Orders\/Order History\.csv:row:[0-9]+$/.test(l.sourceLineRef) || Number(l.sourceLineRef.split(':').at(-1)) < 2 || refs.has(l.sourceLineRef)) throw invalid('Invalid CSV row reference');
    refs.add(l.sourceLineRef);
    if (l.orderKey !== o.orderKey || l.sourceId !== sourceId || l.productId !== null || l.matchMethod !== 'unmatched' || l.amountMinor !== null || ![null, 'JPY'].includes(l.currency)) throw invalid('Invalid CSV line');
    nullableString(l.rawProductName, 2000); date(l.orderedOn);
    if (l.quantity !== null && (!Number.isSafeInteger(l.quantity) || l.quantity <= 0)) throw invalid('Invalid CSV quantity');
    if (!['ordered', 'cancelled', 'unknown'].includes(l.status) || !['accepted', 'excluded', 'needs_review'].includes(l.disposition)) throw invalid('Invalid CSV line status');
    array(l.reasonCodes, reasons.length).forEach(r => { if (!reasons.includes(r)) throw invalid('Invalid CSV reason'); });
    if (JSON.stringify(l.warnings) !== '["price_semantics_unverified"]') throw invalid('Invalid CSV warning');
    origins(l.fieldOrigins, ['rawProductName', 'quantity', 'currency', 'status'], sourceId);
    object(l.identifiers, ['merchantSku']);
    const sku = l.identifiers.merchantSku;
    if (sku !== undefined && (!string(sku, 300).startsWith(`amazon:${account}:`) || sku === `amazon:${account}:`)) throw invalid('Invalid CSV SKU');
    const asin = sku?.slice(`amazon:${account}:`.length);
    if (l.lineMatchKey !== (asin ? identity('amazon_csv_line_hint', o.orderKey, asin) : null)) throw invalid('Invalid CSV line hint');
    nullableString(l.orderDateEvidence, 64);
    if (l.orderedOn !== null) {
      const evidence = l.orderDateEvidence;
      if (!evidence || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(evidence)) throw invalid('Invalid CSV timestamp');
      date(evidence.slice(0, 10));
      const [hour, minute, second] = evidence.slice(11, 19).split(':').map(Number);
      const offset = evidence.match(/[+-](\d{2}):(\d{2})$/);
      if (hour > 23 || minute > 59 || second > 59 || (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))) throw invalid('Invalid CSV timestamp');
      const time = new Date(evidence);
      if (!Number.isFinite(time.getTime())) throw invalid('Invalid CSV timestamp');
      const jst = new Date(time.getTime() + 9 * 3600000).toISOString().slice(0, 10);
      if (jst !== l.orderedOn) throw invalid('CSV date evidence mismatch');
    }
    if (l.cycleEligibleAfterProductMatch !== (l.disposition === 'accepted')) throw invalid('Invalid CSV eligibility');
    if (l.disposition === 'accepted' && (l.reasonCodes.length || l.status !== 'ordered' || !sku || !l.rawProductName || !l.quantity || l.currency !== 'JPY' || l.orderedOn !== o.orderedOn || !o.orderedOn || o.status !== 'ordered' || files.some(f => !s.fileHashes[f]))) throw invalid('Invalid accepted CSV line');
    if (l.disposition !== 'accepted' && (!l.reasonCodes.length || l.status === 'ordered')) throw invalid('Invalid review CSV line');
    if (l.disposition === 'excluded' && !l.reasonCodes.some(r => ['cancelled', 'replacement_not_purchase'].includes(r))) throw invalid('Invalid excluded CSV line');
  }
  const statuses = new Set(o.lines.map(l => l.status));
  const status = statuses.size === 1 && statuses.has('cancelled') ? 'cancelled' : statuses.has('ordered') ? 'ordered' : 'unknown';
  if (status !== o.status) throw invalid('CSV order status mismatch');
  return { s, o, sourceId, batch, inputHash: fingerprint(body) };
}

export function createCsvImporter(db, now = () => new Date()) {
  return async (uid, body, requestId) => {
    if (typeof uid !== 'string' || !uid || uid.includes('/') || uid.length > 128 || ['.', '..'].includes(uid)) throw new AppError('FORBIDDEN', 'Invalid authenticated uid', 403);
    const { s, o, sourceId, batch, inputHash } = validateProposal(body);
    const root = db.collection('users').doc(uid);
    const attempt = root.collection('identityKeys').doc(identity('amazon_csv_attempt', batch, o.orderKey));
    const reservation = root.collection('identityKeys').doc(o.orderKey);
    const source = root.collection('sources').doc(sourceId);
    const clock = Timestamp.fromDate(now());
    return db.runTransaction(async tx => {
      const [attemptSnap, keySnap, sourceSnap] = await Promise.all([tx.get(attempt), tx.get(reservation), tx.get(source)]);
      if (attemptSnap.exists) {
        if (attemptSnap.data().inputHash !== inputHash) throw new AppError('CONFLICT', 'CSV attempt was reused with different input', 409);
        return attemptSnap.data().result;
      }
      const target = keySnap.exists ? keySnap.data().target : { collection: 'purchaseOrders', id: o.orderKey };
      if (target?.collection !== 'purchaseOrders') throw new AppError('CONFLICT', 'Order identity conflict', 409);
      id(target.id);
      const orderRef = root.collection('purchaseOrders').doc(target.id);
      const [orderSnap, lineSnaps] = await Promise.all([tx.get(orderRef), tx.get(root.collection('purchaseLines').where('orderId', '==', target.id).limit(101))]);
      const oldOrder = orderSnap.exists ? orderSnap.data() : null;
      const existing = lineSnaps.docs;
      const review = [];
      if (existing.length > 100) review.push('too_many_existing_lines');
      if (oldOrder && (oldOrder.merchant !== 'amazon' || oldOrder.merchantAccountKey !== s.accountKey || oldOrder.externalOrderId !== o.externalOrderId)) throw new AppError('CONFLICT', 'Order identity conflict', 409);
      if (!o.orderedOn) review.push('unknown_order_date');
      if (o.lines.some(l => !l.rawProductName)) review.push('missing_product_name');
      const sameCsv = oldOrder?.orderDateBasis === 'csv_order_date';
      if (oldOrder && oldOrder.orderedOn !== o.orderedOn && oldOrder.orderDateBasis !== 'gmail_received_date') review.push('order_date_conflict');
      if (oldOrder && !sameCsv && oldOrder.status !== o.status) review.push('order_status_conflict');
      const skuCounts = new Map();
      for (const l of o.lines) { const sku = l.identifiers.merchantSku; if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1); }
      if ([...skuCounts.values()].some(n => n > 1) || o.lines.some(l => !l.identifiers.merchantSku || l.reasonCodes.includes('ambiguous_same_asin_rows'))) review.push('ambiguous_line_identity');
      const updates = [];
      for (const l of o.lines) {
        const matches = existing.filter(d => d.data().identifiers?.merchantSku === l.identifiers.merchantSku);
        if (matches.length > 1 || (oldOrder && !sameCsv && matches.length !== 1)) { review.push('unresolved_existing_line'); continue; }
        const previous = matches[0]?.data();
        if (previous && l.status === 'ordered' && (previous.status !== 'ordered' || previous.quantity !== l.quantity)) { review.push('line_restore_or_quantity_conflict'); continue; }
        if (previous && (previous.rawProductName !== l.rawProductName || (!previous.csvDisposition && (previous.quantity !== l.quantity || previous.status !== l.status)))) { review.push('line_fact_conflict'); continue; }
        // Do not infer a line correspondence from source row position or a name.
        const ref = matches[0]?.ref ?? root.collection('purchaseLines').doc(randomUUID());
        updates.push({ ref, previous, l });
      }
      const held = review.length > 0;
      const result = { sourceId, status: held || o.lines.some(l => l.disposition === 'needs_review') ? 'needs_review' : 'imported', orderId: held ? null : target.id, lineIds: held ? [] : updates.map(x => x.ref.id), reviewCodes: [...new Set(review)] };
      const audits = [];
      function save(ref, before, fields) {
        const changed = Object.entries(fields).filter(([k, v]) => JSON.stringify(serialize(before?.[k] ?? null)) !== JSON.stringify(serialize(v)));
        if (before && !changed.length) return;
        const after = { ...before, ...fields, schemaVersion: 1, revision: (before?.revision ?? 0) + 1, createdAt: before?.createdAt ?? clock, updatedAt: clock };
        tx.set(ref, after);
        audits.push({ schemaVersion: 1, createdAt: clock, recordedAt: clock, actor: 'importer', action: before ? 'merge' : 'import', target: { collection: ref.parent.id, id: ref.id }, sourceId, requestId, methodVersion: 'amazon-csv-v1', changes: Object.entries(after).filter(([k, v]) => JSON.stringify(serialize(before?.[k] ?? null)) !== JSON.stringify(serialize(v))).map(([field, v]) => ({ field, before: serialize(before?.[field] ?? null), after: serialize(v) })) });
      }
      if (!held) {
        const fields = { merchant: 'amazon', merchantAccountKey: s.accountKey, externalOrderId: o.externalOrderId, orderedOn: o.orderedOn, dateTimezone: 'Asia/Tokyo', orderDateBasis: 'csv_order_date', identityStatus: 'confirmed', status: o.status, sourceId, fieldOrigins: { ...oldOrder?.fieldOrigins, orderedOn: { kind: 'source', sourceId }, status: { kind: 'source', sourceId } }, replacementOfOrderKeys: o.replacementOfOrderKeys };
        save(orderRef, oldOrder, fields);
        if (!keySnap.exists) tx.create(reservation, { target, createdAt: clock });
        for (const { ref, previous, l } of updates) {
          const fieldOrigins = { ...previous?.fieldOrigins, ...l.fieldOrigins };
          if (previous?.amountMinor != null && previous.fieldOrigins?.currency) fieldOrigins.currency = previous.fieldOrigins.currency;
          save(ref, previous, { orderId: target.id, sourceId, sourceLineRef: l.sourceLineRef, rawProductName: l.rawProductName, quantity: l.quantity, amountMinor: previous?.amountMinor ?? null, currency: previous?.amountMinor != null ? previous.currency : l.currency, status: l.status, productId: previous?.productId ?? null, matchMethod: previous?.matchMethod ?? 'unmatched', identifiers: { ...previous?.identifiers, ...l.identifiers }, fieldOrigins, csvDisposition: l.disposition, csvReasonCodes: l.reasonCodes, csvOrderDateEvidence: l.orderDateEvidence });
        }
      }
      const oldSource = sourceSnap.exists ? sourceSnap.data() : null;
      const orderIds = [...new Set([...(oldSource?.orderIds ?? []), ...(held ? [] : [target.id])])].sort();
      save(source, oldSource, { provider: 'amazon_csv', accountKey: s.accountKey, fileHashes: s.fileHashes, extractionVersion: 'amazon-csv-v1', status: oldSource?.status === 'needs_review' ? 'needs_review' : result.status, orderIds, attemptCount: (oldSource?.attemptCount ?? 0) + 1, lastAttemptAt: clock, importedAt: held ? oldSource?.importedAt ?? null : clock });
      tx.create(attempt, { createdAt: clock, kind: 'amazon_csv_attempt', inputHash, result });
      for (const audit of audits) tx.create(root.collection('auditLogs').doc(randomUUID()), audit);
      return result;
    });
  };
}
