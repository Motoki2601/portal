import { createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    Object.assign(this, { code, status, retryable });
  }
}
export const invalid = message => new AppError('INVALID_ARGUMENT', message);
export function id(value, label = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw invalid(`Invalid ${label}`);
  return value;
}
export function effective(data) {
  const { userOverrides = {}, ...result } = data;
  const fieldOrigins = { ...result.fieldOrigins };
  for (const [field, override] of Object.entries(userOverrides)) {
    if (['id', 'orderId', 'sourceId', 'revision', 'createdAt', 'updatedAt', 'schemaVersion'].includes(field)) continue;
    result[field] = override.value;
    fieldOrigins[field] = { kind: 'user', observationId: override.observationId };
  }
  return { ...result, fieldOrigins };
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw invalid('Invalid date');
  return value;
}
function key(item) { return [item.order.orderedOn, item.order.id, item.line.id]; }
function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function createApplication(repository, now = () => new Date()) {
  return {
    async importAmazonCsv(uid, body, requestId) {
      return repository.importAmazonCsv(uid, body, requestId);
    },
    async matchProducts(uid, body, requestId) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw invalid('Expected empty JSON object');
      return repository.matchProducts(uid, requestId);
    },
    async getReplenishment(uid, params, includeIneligible = false) {
      if (Object.keys(params).length) throw invalid('Query parameters are not accepted');
      const result = await repository.getReplenishment(uid);
      return { ...result, items: includeIneligible ? result.items : result.items.filter(x => x.candidate.eligible) };
    },
    async getPurchaseHistory(uid, params = {}) {
      const allowed = ['productId', 'fromOn', 'toOn', 'limit', 'cursor'];
      if (Object.keys(params).some(k => !allowed.includes(k))) throw invalid('Unknown query parameter');
      if (params.productId) id(params.productId, 'productId');
      if (params.fromOn) date(params.fromOn);
      if (params.toOn) date(params.toOn);
      if (params.fromOn && params.toOn && params.fromOn > params.toOn) throw invalid('Invalid date range');
      const limit = params.limit === undefined ? 20 : Number(params.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('limit must be 1–100');
      const signature = createHash('sha256').update(JSON.stringify([uid, params.productId ?? null, params.fromOn ?? null, params.toOn ?? null])).digest('hex');
      let cursor;
      if (params.cursor) {
        try {
          if (params.cursor.length > 1024) throw Error();
          const parsed = JSON.parse(Buffer.from(params.cursor, 'base64url').toString());
          if (parsed.signature !== signature || !Array.isArray(parsed.key) || parsed.key.length !== 3) throw Error();
          date(parsed.key[0]); id(parsed.key[1]); id(parsed.key[2]); cursor = parsed.key;
        } catch { throw invalid('Invalid cursor'); }
      }
      // Personal-scale bounded reads ensure overrides are applied before filtering and sorting.
      const { orders, lines, products } = await repository.readHistory(uid);
      const orderMap = new Map(orders.map(o => [o.id, effective(o)]));
      const productMap = new Map(products.map(p => [p.id, effective(p)]));
      const items = lines.map(effective).flatMap(line => {
        const order = orderMap.get(line.orderId);
        if (!order) return [];
        if (params.productId && line.productId !== params.productId) return [];
        if (params.fromOn && order.orderedOn < params.fromOn) return [];
        if (params.toOn && order.orderedOn > params.toOn) return [];
        return [{ order, line, product: productMap.get(line.productId) ?? null, origins: { order: order.fieldOrigins, line: line.fieldOrigins } }];
      }).sort((a, b) => -compare(key(a), key(b))).filter(item => !cursor || compare(key(item), cursor) < 0);
      const page = items.slice(0, limit);
      return { items: page, nextCursor: items.length > limit ? Buffer.from(JSON.stringify({ signature, key: key(page.at(-1)) })).toString('base64url') : null };
    },
    async recordState(uid, body, requestId) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Expected JSON object');
      const fields = ['clientMutationId', 'productId', 'kind', 'value', 'observedAt', 'note'];
      if (Object.keys(body).some(k => !fields.includes(k))) throw invalid('Unknown input field');
      id(body.clientMutationId, 'clientMutationId'); id(body.productId, 'productId');
      if (body.kind !== 'state') throw invalid('This endpoint supports state observations only');
      if (!['unknown', 'likely_available', 'running_low', 'spare_available', 'out_of_stock'].includes(body.value)) throw invalid('Invalid state');
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) throw invalid('Invalid note');
      const clock = now();
      let observedAt = null;
      if (body.observedAt !== undefined) {
        if (typeof body.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.observedAt)) throw invalid('Invalid observedAt');
        date(body.observedAt.slice(0, 10));
        const [hour, minute, second] = body.observedAt.slice(11, 19).split(':').map(Number);
        const offset = body.observedAt.match(/[+-](\d{2}):(\d{2})$/);
        if (hour > 23 || minute > 59 || second > 59 || (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))) throw invalid('Invalid observedAt');
        observedAt = new Date(body.observedAt);
        if (!Number.isFinite(observedAt.getTime()) || observedAt > clock) throw invalid('observedAt must not be in the future');
      }
      // Omitted time is represented as null in the request fingerprint so retries stay identical.
      const input = { productId: body.productId, kind: 'state', value: body.value, observedAt: observedAt?.toISOString() ?? null, note: body.note ?? null };
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const observationId = createHash('sha256').update(JSON.stringify(['v1', body.clientMutationId])).digest('hex');
      return repository.recordState(uid, { ...input, clientMutationId: body.clientMutationId, observationId, fingerprint, observedAt: observedAt ?? clock, recordedAt: clock, requestId });
    },
  };
}
