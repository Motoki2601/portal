import { execFileSync } from 'node:child_process';
// Run the actual Python converter against entirely synthetic rows.
export function csvFixture(tag = 'base', rows = 1, missingRelated = false) {
  const script = `import json,sys\nfrom test_amazon_orders import row\nfrom amazon_orders import normalize,identity,FILES,HISTORY,RETURNS,REFUNDS,REPLACEMENTS\ntables={HISTORY:[row(ASIN='FAKE-SKU-'+str(i)) for i in range(int(sys.argv[2]))],RETURNS:[],REFUNDS:[],REPLACEMENTS:[]}\nif sys.argv[3]=='missing': tables={HISTORY:tables[HISTORY]}\nprint(json.dumps(normalize(tables,{n:identity('synthetic',n,sys.argv[1]) for n in tables},'fixture-account')))\n`;
  const batch = JSON.parse(execFileSync('python3', ['-c', script, tag, String(rows), missingRelated ? 'missing' : 'complete'], { cwd: new URL('../../scripts/personal_commerce/', import.meta.url), encoding: 'utf8' }));
  return { contractVersion: batch.contractVersion, importBatchKey: batch.importBatchKey, source: batch.source, order: batch.orders[0] };
}
