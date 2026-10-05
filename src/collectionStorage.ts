import { doc, onSnapshot, runTransaction, type Firestore } from 'firebase/firestore';
import { applyCollectionOperation, type BaseItem, type CollectionOperation, type CollectionSnapshot } from './collectionOperations.ts';

// Keep the existing per-user data document; apply every operation to its latest
// server value. Firebase retries this callback when another writer wins first.
export function createCollectionStorage<T extends BaseItem>(database: Firestore, collection: 'wishlist' | 'recipes' | 'books') {
  const reference = (uid: string) => doc(database, 'users', uid, collection, 'data');
  return {
    subscribe(uid: string, onChange: (snapshot: CollectionSnapshot<T>) => void, onError: () => void): () => void {
      return onSnapshot(reference(uid), { includeMetadataChanges: true }, snapshot => {
        onChange({ items: (snapshot.data()?.items as T[]) ?? [], ready: !snapshot.metadata.fromCache });
      }, onError);
    },
    save(uid: string, operation: CollectionOperation<T>): Promise<void> {
      return runTransaction(database, async transaction => {
        const ref = reference(uid);
        const snapshot = await transaction.get(ref);
        const items = (snapshot.data()?.items as T[]) ?? [];
        transaction.set(ref, { items: applyCollectionOperation(items, operation) });
      });
    },
  };
}
