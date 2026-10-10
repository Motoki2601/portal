import { applicationDefault } from 'firebase-admin/app';
import { validateSecretReference } from './runtime-config.mjs';

const fail = () => Object.assign(new Error('Pinned secret unavailable'), { code: 'SECRET_UNAVAILABLE' });
function beforeAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(fail());
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, () => { signal.removeEventListener('abort', aborted); reject(fail()); });
  });
}
export function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Server-only allowlist supplied at startup; never accept references from HTTP.
// Construction performs no network request. Credentials/payloads are not logged.
export function createPinnedSecretReader({ allowedReferences, credential, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!Array.isArray(allowedReferences) || !allowedReferences.length || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw fail();
  const allowed = new Set(allowedReferences.map(validateSecretReference));
  return async (reference, { signal } = {}) => {
    try {
      validateSecretReference(reference);
      if (!allowed.has(reference) || signal?.aborted) throw fail();
      const timeout = AbortSignal.timeout(timeoutMs);
      const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const auth = await beforeAbort((credential ?? applicationDefault()).getAccessToken(), activeSignal);
      if (!auth || typeof auth.access_token !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(auth.access_token)) throw fail();
      const response = await fetchImpl(`https://secretmanager.googleapis.com/v1/${reference}:access`, {
        method: 'GET', redirect: 'error', signal: activeSignal,
        headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
      });
      if (!response.ok) throw fail();
      const body = await response.text();
      if (body.length > 100000) throw fail();
      const data = JSON.parse(body), payload = data.payload;
      // Strict resource matching can reject project-ID/number normalization.
      // Configure the canonical reference; do not silently widen the allowlist.
      if (data.name !== reference || typeof payload?.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.data)) throw fail();
      const bytes = Buffer.from(payload.data, 'base64');
      if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== payload.data) throw fail();
      const checksum = payload.dataCrc32c;
      if (!((typeof checksum === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(checksum)) || Number.isInteger(checksum)) || Number(checksum) !== crc32c(bytes)) throw fail();
      return bytes;
    } catch { throw fail(); }
  };
}
