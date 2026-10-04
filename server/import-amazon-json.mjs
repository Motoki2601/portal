import { readFile } from 'node:fs/promises';
import { validateProposal } from './amazon-csv.mjs';

// Explicit, authenticated HTTP upload; never use Admin credentials on the client.
const [inputPath, apiUrl, tokenPath] = process.argv.slice(2);
try {
  if (!inputPath || !apiUrl || !tokenPath) throw Error();
  const url = new URL(apiUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error();
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!token || /\s/.test(token)) throw Error();
  if (!Array.isArray(input.orders) || input.orders.length > 5000) throw Error();
  const proposals = input.orders.map(order => ({ contractVersion: input.contractVersion, importBatchKey: input.importBatchKey, source: input.source, order }));
  // Validate every order before any network writes; a format error causes no partial upload.
  proposals.forEach(validateProposal);
  const counts = { processed: 0, imported: 0, needsReview: 0 };
  for (const proposal of proposals) {
    const response = await fetch(new URL('/imports/amazon-csv', url), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(proposal) });
    if (!response.ok) {
      console.error(JSON.stringify({ code: 'CSV_UPLOAD_STOPPED', httpStatus: response.status, ...counts }));
      process.exit(1);
    }
    const result = await response.json();
    counts.processed++;
    if (result.status === 'imported') counts.imported++;
    else if (result.status === 'needs_review') counts.needsReview++;
    else throw Error();
  }
  console.log(JSON.stringify(counts));
} catch {
  console.error('CSV_UPLOAD_INPUT_OR_CONNECTION_ERROR');
  process.exitCode = 1;
}
