import { doc, onSnapshot, runTransaction, type DocumentReference } from 'firebase/firestore';
import { db } from './firebase';
import type { WishItem, RecipeItem, BookItem } from './types';
import { applyCollectionOperation, type BaseItem, type CollectionOperation, type CollectionSnapshot } from './collectionOperations';

const wishlistDocRef = (uid: string) => doc(db, 'users', uid, 'wishlist', 'data');
const recipesDocRef = (uid: string) => doc(db, 'users', uid, 'recipes', 'data');
const booksDocRef = (uid: string) => doc(db, 'users', uid, 'books', 'data');

function subscribeCollection<T>(ref: DocumentReference, onChange: (snapshot: CollectionSnapshot<T>) => void, onError: () => void): () => void {
  return onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    onChange({ items: (snap.data()?.items as T[]) ?? [], ready: !snap.metadata.fromCache });
  }, onError);
}

function saveCollection<T extends BaseItem>(ref: DocumentReference, operation: CollectionOperation<T>): Promise<void> {
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const items = (snapshot.data()?.items as T[]) ?? [];
    transaction.set(ref, { items: applyCollectionOperation(items, operation) });
  });
}

export function subscribeItems(uid: string, onChange: (snapshot: CollectionSnapshot<WishItem>) => void, onError: () => void): () => void {
  return subscribeCollection(wishlistDocRef(uid), onChange, onError);
}
export function saveItems(uid: string, operation: CollectionOperation<WishItem>): Promise<void> {
  return saveCollection(wishlistDocRef(uid), operation);
}
export function subscribeRecipes(uid: string, onChange: (snapshot: CollectionSnapshot<RecipeItem>) => void, onError: () => void): () => void {
  return subscribeCollection(recipesDocRef(uid), onChange, onError);
}
export function saveRecipes(uid: string, operation: CollectionOperation<RecipeItem>): Promise<void> {
  return saveCollection(recipesDocRef(uid), operation);
}
export function subscribeBooks(uid: string, onChange: (snapshot: CollectionSnapshot<BookItem>) => void, onError: () => void): () => void {
  return subscribeCollection(booksDocRef(uid), onChange, onError);
}
export function saveBooks(uid: string, operation: CollectionOperation<BookItem>): Promise<void> {
  return saveCollection(booksDocRef(uid), operation);
}
