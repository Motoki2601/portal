import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createApplication } from './application.mjs';
import { createFirestoreRepository } from './firestore.mjs';
import { createApi } from './http.mjs';
import { createCsvImporter } from './amazon-csv.mjs';
import { createConversationApplication, createConversationRepository } from './conversation.mjs';
import { createReplenishmentOperations } from './replenishment.mjs';

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const allowedUids = (process.env.ALLOWED_UIDS ?? '').split(',').map(v => v.trim()).filter(Boolean);
const allowedOrigins = (process.env.PORTAL_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean);
if (!projectId || !allowedUids.length || !allowedOrigins.length) throw Error('GOOGLE_CLOUD_PROJECT, ALLOWED_UIDS and PORTAL_ORIGINS are required');
for (const origin of allowedOrigins) {
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw Error('PORTAL_ORIGINS must contain exact origins without paths');
}
if (process.env.K_SERVICE && (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Emulator environment is prohibited on Cloud Run');
const app = initializeApp({ projectId, credential: applicationDefault() });
const repository = createFirestoreRepository(getFirestore(app));
repository.importAmazonCsv = createCsvImporter(getFirestore(app));
Object.assign(repository, createReplenishmentOperations(getFirestore(app)));
Object.assign(repository, createConversationRepository(getFirestore(app)));
const application = createApplication(repository);
Object.assign(application, createConversationApplication(application, repository));
const api = createApi({ application, verifyToken: token => getAuth(app).verifyIdToken(token, true), allowedUids, allowedOrigins, log: entry => console.error(JSON.stringify(entry)) });
api.requestTimeout = 30000;
api.headersTimeout = 15000;
api.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
