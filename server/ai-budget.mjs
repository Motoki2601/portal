import { createHash } from 'node:crypto';

export const BUDGET_FALLBACK = Object.freeze({ deferImports: true, history: true, replenishment: true, notificationPrice: false });
export function monthKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Invalid clock');
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 7);
}
const money = value => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid micro-JPY amount'); return value; };
const key = value => { if (typeof value !== 'string' || !value || value.length > 256) throw new Error('Invalid identifier'); return createHash('sha256').update(value).digest('hex'); };

// Server-only scope: all owners/providers share the same monthly ceiling.
export function createAiBudgetGate(db, { scope = 'personal-commerce', clock = () => new Date(), limitMicros = 700000000 } = {}) {
  money(limitMicros);
  if (limitMicros > 700000000) throw new Error('Monthly ceiling exceeds approved 700 JPY');
  const root = db.collection('aiBudgetScopes').doc(key(scope));
  const deny = code => ({ allowed: false, code, fallback: BUDGET_FALLBACK });
  const reservation = id => root.collection('reservations').doc(key(id));
  return {
    async reserve(input) {
      const { operationId, kind, model, upperBoundJpyMicro, pricingVersion, hardBoundVerified } = input;
      const ref = reservation(operationId);
      money(upperBoundJpyMicro);
      if (hardBoundVerified !== true || typeof pricingVersion !== 'string' || !pricingVersion.trim() || model !== 'gemini-3.5-flash-lite' || !['ai', 'search'].includes(kind) || upperBoundJpyMicro === 0) return deny('UNVERIFIED_COST_BOUND');
      const fingerprint = JSON.stringify([kind, model, upperBoundJpyMicro, pricingVersion]);
      const month = monthKey(clock()), ledgerRef = root.collection('months').doc(month);
      return db.runTransaction(async tx => {
        const old = await tx.get(ref);
        if (old.exists) {
          if (old.data().fingerprint !== fingerprint) throw new Error('Operation ID conflict');
          const control = await tx.get(root);
          if (control.exists && control.data().blocked) return deny('COST_OVERRUN');
          const prior = old.data();
          const replay = { reservationId: operationId, state: prior.state, replay: true };
          if (prior.state !== 'reserved') return { ...deny('OPERATION_NOT_RESERVABLE'), ...replay };
          if (prior.month !== month) return { ...deny('RESERVATION_MONTH_EXPIRED'), ...replay };
          return { allowed: true, ...replay };
        }
        const [ledgerSnap, control] = await Promise.all([tx.get(ledgerRef), tx.get(root)]);
        const ledger = ledgerSnap.exists ? ledgerSnap.data() : { committedMicros: 0, heldMicros: 0 };
        if (control.exists && control.data().blocked) return deny('COST_OVERRUN');
        money(ledger.committedMicros); money(ledger.heldMicros);
        if (upperBoundJpyMicro > limitMicros - ledger.committedMicros - ledger.heldMicros) return deny('MONTHLY_BUDGET_EXHAUSTED');
        tx.set(ledgerRef, { ...ledger, heldMicros: ledger.heldMicros + upperBoundJpyMicro });
        tx.create(ref, { fingerprint, month, amountMicros: upperBoundJpyMicro, state: 'reserved' });
        return { allowed: true, reservationId: operationId, state: 'reserved', replay: false };
      });
    },
    async claimDispatch(id) {
      return db.runTransaction(async tx => {
        const ref = reservation(id), [snap, control] = await Promise.all([tx.get(ref), tx.get(root)]);
        if ((control.exists && control.data().blocked) || !snap.exists || snap.data().state !== 'reserved' || snap.data().month !== monthKey(clock())) return false;
        // Claim is burned even if the process dies before sending. Never auto-reissue.
        tx.update(ref, { state: 'dispatched' }); return true;
      });
    },
    async markUnknown(id) {
      return db.runTransaction(async tx => {
        const ref = reservation(id), snap = await tx.get(ref);
        if (!snap.exists || !['dispatched', 'unknown'].includes(snap.data().state)) throw new Error('Not dispatched');
        tx.update(ref, { state: 'unknown' }); return { state: 'unknown' };
      });
    },
    async settle(id, actualJpyMicro) { return finish(id, money(actualJpyMicro), false); },
    async cancel(id) { return finish(id, 0, true); },
  };
  async function finish(id, actual, cancel) {
    return db.runTransaction(async tx => {
      const ref = reservation(id), snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Unknown reservation');
      const old = snap.data(), state = cancel ? 'cancelled' : 'settled';
      if (old.state === state && old.actualMicros === actual) return { state, overrun: actual > old.amountMicros };
      if (!(cancel ? old.state === 'reserved' : ['dispatched', 'unknown'].includes(old.state))) throw new Error('Invalid reservation transition');
      const ledgerRef = root.collection('months').doc(old.month), ledger = (await tx.get(ledgerRef)).data();
      const overrun = actual > old.amountMicros;
      tx.update(ledgerRef, { heldMicros: ledger.heldMicros - old.amountMicros, committedMicros: money(ledger.committedMicros + actual) });
      tx.update(ref, { state, actualMicros: actual });
      if (overrun) tx.set(root, { blocked: true, reason: 'COST_OVERRUN' }, { merge: true });
      return { state, overrun };
    });
  }
}
