import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/commerce-api.ts', import.meta.url), 'utf8')
  .replace("import { auth } from './firebase';", '')
  .replace('import.meta.env.VITE_COMMERCE_API_URL', 'undefined');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
const require = createRequire(import.meta.url);
function setup(fetchImpl, getIdToken = async () => 'synthetic-token') {
  const auth = { currentUser: { uid: 'fixture-user' } };
  const exports = {};
  new Function('exports', 'require', 'auth', 'fetch', compiled)(exports, require, auth, fetchImpl);
  return { auth, user: { uid: 'fixture-user', getIdToken }, request: exports.commerceRequest };
}

test('uses Firebase bearer token, no credentials or UID payload, and one dispatch', async () => {
  const body = { clientMutationId: 'fixed-operation', productId: 'fixture-product', kind: 'state', value: 'spare_available' };
  let calls = 0;
  const { user, request } = setup(async (url, options) => {
    calls++;
    assert.equal(url, 'https://portal-commerce-api-3pcdbakkqa-an.a.run.app/user-observations');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), body);
    return new Response('{"ok":true}', { status: 200 });
  });
  assert.deepEqual(await request(user, '/user-observations', undefined, body), { ok: true });
  assert.equal(calls, 1);
});

test('account change during token acquisition prevents dispatch', async () => {
  let calls = 0;
  let auth;
  const context = setup(async () => { calls++; }, async () => { auth.currentUser = { uid: 'different-user' }; return 'synthetic-token'; });
  auth = context.auth;
  await assert.rejects(context.request(context.user, '/me'), /ログイン/);
  assert.equal(calls, 0);
});

test('account change while waiting discards old response', async () => {
  let context;
  context = setup(async () => { context.auth.currentUser = null; return new Response('{"items":[]}'); });
  await assert.rejects(context.request(context.user, '/purchase-history'), /ログイン/);
});

test('unauthorized/forbidden responses never expose raw provider bodies', async () => {
  for (const status of [401, 403, 500]) {
    const { user, request } = setup(async () => new Response('private-provider-message', { status }));
    await assert.rejects(request(user, '/me'), error => !error.message.includes('private-provider-message'));
  }
});

test('unknown mutation result is not retried and tells user to retry same input', async () => {
  let calls = 0;
  const { user, request } = setup(async () => { calls++; throw Error('private-token'); });
  await assert.rejects(request(user, '/user-observations', undefined, { clientMutationId: 'stable' }), /同じ内容/);
  assert.equal(calls, 1);
});

test('invalid JSON does not report a successful save', async () => {
  const { user, request } = setup(async () => new Response('not-json'));
  await assert.rejects(request(user, '/user-observations', undefined, {}), /保存結果を確認できません/);
});
