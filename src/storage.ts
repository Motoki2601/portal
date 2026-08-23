import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { WishItem, RecipeItem, BookItem } from './types';

const wishlistDocRef = (uid: string) => doc(db, 'users', uid, 'wishlist', 'data');
const recipesDocRef = (uid: string) => doc(db, 'users', uid, 'recipes', 'data');
const booksDocRef = (uid: string) => doc(db, 'users', uid, 'books', 'data');

export function subscribeItems(uid: string, onChange: (items: WishItem[]) => void): () => void {
  return onSnapshot(wishlistDocRef(uid), snap => {
    const data = snap.data();
    onChange((data?.items as WishItem[]) ?? []);
  });
}

export function saveItems(uid: string, items: WishItem[]): Promise<void> {
  return setDoc(wishlistDocRef(uid), { items });
}

export function subscribeRecipes(uid: string, onChange: (items: RecipeItem[]) => void): () => void {
  return onSnapshot(recipesDocRef(uid), snap => {
    const data = snap.data();
    onChange((data?.items as RecipeItem[]) ?? []);
  });
}

export function saveRecipes(uid: string, items: RecipeItem[]): Promise<void> {
  return setDoc(recipesDocRef(uid), { items });
}

export function subscribeBooks(uid: string, onChange: (items: BookItem[]) => void): () => void {
  return onSnapshot(booksDocRef(uid), snap => {
    const data = snap.data();
    onChange((data?.items as BookItem[]) ?? []);
  });
}

export function saveBooks(uid: string, items: BookItem[]): Promise<void> {
  return setDoc(booksDocRef(uid), { items });
}
