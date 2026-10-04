import { Timestamp } from 'firebase-admin/firestore';
import { AppError, id } from './application.mjs';

export function serialize(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  return value;
}
export function createFirestoreRepository(db) {
  function user(uid) {
    if (typeof uid !== 'string' || !uid || uid.includes('/') || uid.length > 128 || uid === '.' || uid === '..') throw new AppError('FORBIDDEN', 'Invalid authenticated uid', 403);
    return db.collection('users').doc(uid);
  }
  return {
    async readHistory(uid) {
      const root = user(uid);
      const read = async name => {
        const snap = await root.collection(name).limit(5001).get();
        if (snap.size > 5000) throw new AppError('RESOURCE_EXHAUSTED', 'Personal-scale history limit exceeded', 413);
        return snap.docs.map(d => ({ ...d.data(), id: d.id }));
      };
      const [orders, lines, products] = await Promise.all(['purchaseOrders', 'purchaseLines', 'products'].map(read));
      return { orders, lines, products };
    },
    async recordState(uid, input) {
      const root = user(uid);
      id(input.productId);
      const observation = root.collection('userObservations').doc(input.observationId);
      const product = root.collection('products').doc(input.productId);
      const state = root.collection('productStates').doc(input.productId);
      // Deterministic audit ID prevents a retried transaction from duplicating the audit.
      const audit = root.collection('auditLogs').doc(input.observationId);
      return db.runTransaction(async tx => {
        const [oldObservation, productSnap, stateSnap] = await Promise.all([tx.get(observation), tx.get(product), tx.get(state)]);
        if (oldObservation.exists) {
          const previous = oldObservation.data();
          if (previous.inputFingerprint !== input.fingerprint) throw new AppError('CONFLICT', 'Mutation ID was reused with different input', 409);
          return serialize(previous.result);
        }
        if (!productSnap.exists) throw new AppError('NOT_FOUND', 'Product not found', 404);
        const old = stateSnap.exists ? stateSnap.data() : { state: 'unknown', origin: 'unknown', usage: 'unknown', usageOrigin: 'unknown', observedAt: null, observationId: null, usageObservationId: null, suppressUntil: null, revision: 0 };
        const oldTime = old.observedAt?.toDate?.() ?? (old.observedAt ? new Date(old.observedAt) : null);
        const oldRecordedAt = old.stateRecordedAt?.toDate?.();
        const priority = !oldTime || input.observedAt > oldTime || (input.observedAt.getTime() === oldTime.getTime() && (!oldRecordedAt || input.recordedAt > oldRecordedAt || (input.recordedAt.getTime() === oldRecordedAt.getTime() && input.observationId > (old.observationId ?? ''))));
        // A historical observation may be recorded, but cannot replace a newer explicit state.
        const apply = old.origin !== 'user' || priority;
        const recordedAt = Timestamp.fromDate(input.recordedAt);
        const next = apply ? { ...old, schemaVersion: 1, revision: old.revision + 1, createdAt: old.createdAt ?? recordedAt, updatedAt: recordedAt, state: input.value, origin: 'user', observedAt: Timestamp.fromDate(input.observedAt), stateRecordedAt: recordedAt, observationId: input.observationId, suppressUntil: ['likely_available', 'spare_available'].includes(input.value) ? Timestamp.fromMillis(input.observedAt.getTime() + 7 * 86400000) : null } : old;
        const result = serialize({ observationId: input.observationId, effectiveState: next, revision: next.revision });
        const observationData = { schemaVersion: 1, createdAt: recordedAt, kind: 'state', target: { collection: 'products', id: input.productId }, productId: input.productId, value: input.value, source: 'user', clientMutationId: input.clientMutationId, observedAt: Timestamp.fromDate(input.observedAt), recordedAt, inputFingerprint: input.fingerprint, result };
        if (input.note !== null) observationData.note = input.note;
        tx.create(observation, observationData);
        if (apply) tx.set(state, next);
        tx.create(audit, { schemaVersion: 1, createdAt: recordedAt, recordedAt, actor: 'user', action: 'observe', target: { collection: 'productStates', id: input.productId }, observationId: input.observationId, requestId: input.requestId, changes: apply ? [{ field: 'state', before: old.state, after: input.value }, { field: 'origin', before: old.origin, after: 'user' }, { field: 'observationId', before: old.observationId, after: input.observationId }, { field: 'suppressUntil', before: serialize(old.suppressUntil), after: serialize(next.suppressUntil) }] : [], reason: apply ? 'user_explicit_state' : 'historical_observation_only' });
        // Candidate computation belongs to the later replenishment operation, not this initial API.
        return result;
      });
    },
  };
}
