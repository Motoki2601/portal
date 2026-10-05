import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, disableNetwork, enableNetwork, terminate } from 'firebase/firestore';
import { createCollectionStorage } from '../src/collectionStorage.ts';
import { canMutateCollection } from '../src/collectionOperations.ts';
const { initializeTestEnvironment } = createRequire(new URL('../server/package.json', import.meta.url))('@firebase/rules-unit-testing');
const item = (id, updatedAt = 'v1') => ({ id, name: id, purchased: false, createdAt: 'created', updatedAt });

test('real browser SDK collection storage with production rules', { timeout: 60000 }, async t => {
  assert(process.env.FIRESTORE_EMULATOR_HOST, 'Emulator required; never run against production');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const environment = await initializeTestEnvironment({
    projectId: 'demo-portal', firestore: { host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  const clients = ['first', 'second', 'other'].map(name => {
    const app = initializeApp({ projectId: 'demo-portal', apiKey: 'fake', appId: name }, name);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: name === 'other' ? 'other' : 'owner' } });
    return { app, db, storage: createCollectionStorage(db, 'wishlist') };
  });
  t.after(async () => {
    await Promise.all(clients.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); }));
    await environment.cleanup();
  });
  await environment.clearFirestore();
  const [first, second, other] = clients;
  const reference = doc(first.db, 'users/owner/wishlist/data');

  await t.test('simultaneous additions preserve existing items and both additions', async () => {
    await setDoc(reference, { items: [item('existing')] });
    await Promise.all([
      first.storage.save('owner', { kind: 'add', item: item('first-add') }),
      second.storage.save('owner', { kind: 'add', item: item('second-add') }),
    ]);
    const ids = (await getDoc(reference)).data().items.map(x => x.id).sort();
    assert.deepEqual(ids, ['existing', 'first-add', 'second-add']);
  });
  await t.test('stale edit and deletion are rejected through actual save', async () => {
    await first.storage.save('owner', { kind: 'edit', id: 'existing', expectedUpdatedAt: 'v1', data: { name: 'edited', purchased: false }, updatedAt: 'v2' });
    await assert.rejects(second.storage.save('owner', { kind: 'edit', id: 'existing', expectedUpdatedAt: 'v1', data: { name: 'stale', purchased: false }, updatedAt: 'v3' }), /changed/);
    await assert.rejects(second.storage.save('owner', { kind: 'remove', id: 'existing', expectedUpdatedAt: 'v1' }), /changed/);
    const items = (await getDoc(reference)).data().items;
    assert.equal(items.length, 3);
    assert.equal(items.find(x => x.id === 'existing').name, 'edited');
  });
  await t.test('status updates preserve concurrent edits and other items', async () => {
    await second.storage.save('owner', { kind: 'update', id: 'existing', patch: { purchased: true }, updatedAt: 'v3' });
    const items = (await getDoc(reference)).data().items;
    assert.equal(items.length, 3);
    assert.equal(items.find(x => x.id === 'existing').name, 'edited');
    assert.equal(items.find(x => x.id === 'existing').purchased, true);
  });
  await t.test('cached snapshots stay blocked until a server snapshot arrives', async () => {
    await disableNetwork(second.db);
    let sawCache = false;
    let unsubscribe;
    await new Promise((resolve, reject) => {
      unsubscribe = second.storage.subscribe('owner', snapshot => {
        if (!snapshot.ready) {
          sawCache = true;
          assert.equal(canMutateCollection({ uid: 'owner', ready: snapshot.ready, error: false }, 'owner'), false);
          void enableNetwork(second.db).catch(reject);
        } else resolve();
      }, () => reject(new Error('Subscription failed')));
    });
    unsubscribe();
    assert(sawCache);
  });
  await t.test('production rules reject another user and subscription reports error', async () => {
    await assert.rejects(other.storage.save('owner', { kind: 'add', item: item('forbidden') }), error => error.code === 'permission-denied');
    let unsubscribe;
    await new Promise(resolve => {
      unsubscribe = other.storage.subscribe('owner', () => {}, resolve);
    });
    unsubscribe();
    assert.equal((await getDoc(reference)).data().items.length, 3);
  });
});
