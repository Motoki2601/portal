import { readFile, writeFile } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// This helper must never seed a real project.
if (process.env.GOOGLE_CLOUD_PROJECT !== 'demo-portal' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')) throw Error('Local demo-portal emulators are required');
const app = initializeApp({ projectId: 'demo-portal' });
const auth = getAuth(app); const db = getFirestore(app);
try { await auth.createUser({ uid: 'fixture-owner' }); } catch (e) { if (e.code !== 'auth/uid-already-exists') throw e; }
const customToken = await auth.createCustomToken('fixture-owner');
const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
if (!response.ok) throw Error('Emulator sign-in failed');
const { idToken } = await response.json();
await writeFile(new URL('.emulator-id-token', import.meta.url), idToken, { mode: 0o600 });
const fixture = JSON.parse(await readFile(new URL('fixtures/purchase-history.json', import.meta.url), 'utf8'));
const batch = db.batch(); const time = Timestamp.fromDate(new Date('2026-07-01T03:00:00Z'));
for (const [collection, records] of Object.entries(fixture)) for (const [id, data] of Object.entries(records)) {
  const document = { ...data, createdAt: time, updatedAt: time };
  for (const field of ['receivedAt', 'lastAttemptAt', 'importedAt']) if (typeof document[field] === 'string') document[field] = Timestamp.fromDate(new Date(document[field]));
  batch.set(db.doc(`users/fixture-owner/${collection}/${id}`), document);
}
await batch.commit();
console.log('Seeded synthetic history for fixture-owner; emulator token is in server/.emulator-id-token');
await db.terminate();
