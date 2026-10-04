import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AppError, invalid } from './application.mjs';
import { serialize } from './firestore.mjs';

export function createApi({ application, verifyToken, allowedOrigins, allowedUids, log = () => {} }) {
  if (!allowedOrigins?.length || !allowedUids?.length) throw Error('Origins and uid allowlists must be configured');
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(serialize(body))); };
    try {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) throw new AppError('FORBIDDEN', 'Origin is not allowed', 403);
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        if (!origin) throw invalid('Origin is required for preflight');
        const requestedHeaders = (req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(v => v.trim()).filter(Boolean);
        if (requestedHeaders.some(h => !['authorization', 'content-type'].includes(h)) || !['GET', 'POST'].includes(req.headers['access-control-request-method'])) throw invalid('Unsupported preflight');
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }); res.end(); return;
      }
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') { send(200, { status: 'ok' }); return; }
      const header = req.headers.authorization;
      if (typeof header !== 'string' || !/^Bearer \S{1,8192}$/.test(header)) throw new AppError('UNAUTHENTICATED', 'Firebase ID token is required', 401);
      let claims;
      try { claims = await verifyToken(header.slice(7)); }
      catch (error) {
        const invalidTokenCodes = ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'];
        if (invalidTokenCodes.includes(error.code)) throw new AppError('UNAUTHENTICATED', 'Invalid Firebase ID token', 401);
        throw new AppError('UNAVAILABLE', 'Authentication service unavailable', 503, true);
      }
      const uid = claims?.uid;
      if (!allowedUids.includes(uid)) throw new AppError('FORBIDDEN', 'User is not allowed', 403);
      if (req.method === 'GET' && url.pathname === '/me') { send(200, { uid }); return; }
      if (req.method === 'GET' && url.pathname === '/purchase-history') {
        for (const name of new Set(url.searchParams.keys())) if (url.searchParams.getAll(name).length !== 1) throw invalid('Repeated query parameter');
        send(200, await application.getPurchaseHistory(uid, Object.fromEntries(url.searchParams))); return;
      }
      if (req.method === 'POST' && url.pathname === '/user-observations') {
        if (url.search) throw invalid('Query parameters are not accepted');
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw invalid('Content-Type must be application/json');
        const chunks = await new Promise((resolve, reject) => {
          let size = 0; const parts = [];
          req.on('data', chunk => { size += chunk.length; if (size <= 8192) parts.push(chunk); });
          req.on('end', () => size > 8192 ? reject(new AppError('INVALID_ARGUMENT', 'Body too large', 413)) : resolve(parts));
          req.on('error', reject);
        });
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid('Invalid JSON'); }
        send(200, await application.recordState(uid, body, requestId)); return;
      }
      throw new AppError('NOT_FOUND', 'Operation not found', 404);
    } catch (error) {
      const known = error instanceof AppError;
      const code = known ? error.code : 'INTERNAL';
      log({ requestId, code }); // Never log token, body, personal identifiers, or raw exception messages.
      send(known ? error.status : 500, { code, message: known ? error.message : 'Internal error', retryable: known ? error.retryable : true, requestId });
    }
  });
}
