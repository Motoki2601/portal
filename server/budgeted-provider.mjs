import { BUDGET_FALLBACK } from './ai-budget.mjs';
import { createHash } from 'node:crypto';

const deny = code => ({ allowed: false, code, fallback: BUDGET_FALLBACK });
function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  throw new Error('Provider request must be JSON');
}

// Server-only adapter dependencies. prepare must enforce a verified total cost
// bound and sanitize the request; dispatch must disable automatic SDK retries.
// Neither cost metadata nor operation IDs may come from model/user arguments.
export function createBudgetedProvider({ gate, prepare, dispatch }) {
  if (!gate || typeof prepare !== 'function' || typeof dispatch !== 'function') throw new Error('Budgeted provider dependencies required');
  return async (input, { operationId, signal } = {}) => {
    if (signal?.aborted) return deny('CALL_CANCELLED');
    let prepared, request, requestFingerprint;
    try {
      prepared = await prepare(input);
      request = canonicalJson(prepared.request);
      requestFingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    }
    catch { return deny('PROVIDER_PREPARATION_FAILED'); }
    if (signal?.aborted) return deny('CALL_CANCELLED');
    let reservation;
    try {
      // Explicit projection: prepare cannot replace the host operation identity.
      const { kind, model, upperBoundJpyMicro, pricingVersion, hardBoundVerified } = prepared.cost;
      reservation = await gate.reserve({ operationId, kind, model, upperBoundJpyMicro, pricingVersion, hardBoundVerified, requestFingerprint });
    } catch { return deny('BUDGET_LEDGER_UNAVAILABLE'); }
    if (!reservation.allowed) return reservation;
    if (signal?.aborted) {
      try { await gate.cancel(reservation.reservationId); }
      catch { return deny('BUDGET_LEDGER_UNAVAILABLE'); }
      return deny('CALL_CANCELLED');
    }
    let claimed;
    try { claimed = await gate.claimDispatch(reservation.reservationId); }
    catch { return deny('BUDGET_LEDGER_UNAVAILABLE'); }
    if (!claimed) return deny('DISPATCH_NOT_GRANTED');

    // Once claimed, any failure is conservatively unknown, even a pre-send crash.
    // Preserve the hold; never cancel or retry an ambiguously dispatched call.
    try {
      if (signal?.aborted) throw new Error('Cancelled after claim');
      const response = await dispatch(request, { signal });
      // actualJpyMicro is calculated by the trusted adapter from provider usage,
      // never from generated text. Missing/invalid usage retains the reservation.
      if (!response || !Object.hasOwn(response, 'value') || !Number.isSafeInteger(response.actualJpyMicro) || response.actualJpyMicro < 0) throw new Error('Unknown provider cost');
      const settlement = await gate.settle(reservation.reservationId, response.actualJpyMicro);
      if (settlement.overrun) return deny('COST_OVERRUN');
      if (signal?.aborted) return deny('CALL_CANCELLED');
      return { allowed: true, value: response.value };
    } catch {
      try { await gate.markUnknown(reservation.reservationId); }
      catch { /* A dispatched reservation still retains its hold if storage fails. */ }
      return deny('PROVIDER_RESULT_UNKNOWN');
    }
  };
}
