import assert from 'node:assert/strict';

// Sequential transaction double; real contention remains covered by Emulator tests.
export function memoryDb() {
  const docs = new Map();
  const ref = path => ({ path, collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }) });
  return {
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    runTransaction: async fn => fn({
      get: async r => ({ exists: docs.has(r.path), data: () => docs.get(r.path) }),
      create: (r, data) => { assert(!docs.has(r.path)); docs.set(r.path, data); },
      set: (r, data, options) => docs.set(r.path, options?.merge ? { ...docs.get(r.path), ...data } : data),
      update: (r, data) => { assert(docs.has(r.path)); docs.set(r.path, { ...docs.get(r.path), ...data }); },
    }),
  };
}

