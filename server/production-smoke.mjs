import { pathToFileURL } from 'node:url';

export async function runProductionSmoke({ baseUrl, idToken, expectedUid, origin, otherUserToken, fetchImpl = fetch }) {
  let base, portal;
  try { base = new URL(baseUrl); portal = new URL(origin); } catch { throw Error('Invalid smoke configuration'); }
  if (base.protocol !== 'https:' || base.origin !== baseUrl || portal.protocol !== 'https:' || portal.origin !== origin ||
      !expectedUid || expectedUid.length > 128 || !idToken || /\s/.test(idToken) ||
      (otherUserToken && /\s/.test(otherUserToken))) throw Error('Invalid smoke configuration');
  const results = [];
  async function check(name, path, status, headers = {}, verify, method = 'GET') {
    let response;
    try {
      response = await fetchImpl(baseUrl + path, { method, headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw Error(name + ': request failed'); }
    if (response.status !== status) throw Error(name + ': unexpected status');
    if (headers.Origin === origin && response.headers.get('access-control-allow-origin') !== origin) throw Error(name + ': CORS mismatch');
    if (verify) {
      let body;
      try { body = await response.json(); } catch { throw Error(name + ': invalid JSON'); }
      if (!verify(body)) throw Error(name + ': invalid response');
    }
    results.push({ check: name, status: 'passed' });
  }
  await check('health', '/health', 200, {}, body => body.status === 'ok');
  await check('unauthenticated', '/me', 401);
  await check('invalid-token', '/me', 401, { Authorization: 'Bearer deliberately-invalid' });
  const authenticated = { Authorization: 'Bearer ' + idToken, Origin: origin };
  await check('verified-user', '/me', 200, authenticated, body => body.uid === expectedUid);
  // Read-only. Bodies are validated in memory and never emitted.
  await check('purchase-history', '/purchase-history?limit=1', 200, authenticated, body => Array.isArray(body.items) && (body.nextCursor === null || typeof body.nextCursor === 'string'));
  await check('forbidden-origin', '/me', 403, { ...authenticated, Origin: 'https://forbidden.invalid' });
  await check('preflight', '/me', 204, { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' }, undefined, 'OPTIONS');
  if (otherUserToken) await check('other-user', '/me', 403, { Authorization: 'Bearer ' + otherUserToken });
  return { readOnly: true, results, remaining: [
    ...(otherUserToken ? [] : ['other-user token not supplied']),
    'Real revoked/expired/wrong-project token checks',
    'Firestore Rules direct-access rejection and existing Portal regression',
    'Anonymous observation transaction and runtime IAM write verification',
  ] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runProductionSmoke({
      baseUrl: process.env.COMMERCE_API_URL, idToken: process.env.SMOKE_ID_TOKEN,
      expectedUid: process.env.SMOKE_EXPECTED_UID, origin: process.env.SMOKE_PORTAL_ORIGIN,
      otherUserToken: process.env.SMOKE_OTHER_USER_TOKEN,
    });
    console.log(JSON.stringify(report));
  } catch (error) {
    // Only locally generated messages, never provider bodies/tokens/identifiers.
    console.error(error.message);
    process.exitCode = 1;
  }
}
