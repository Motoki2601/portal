import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { WishItem } from './types';

const docRef = (uid: string) => doc(db, 'users', uid, 'wishlist', 'data');

export function subscribeItems(uid: string, onChange: (items: WishItem[]) => void): () => void {
  return onSnapshot(docRef(uid), snap => {
    const data = snap.data();
    onChange((data?.items as WishItem[]) ?? []);
  });
}

export function saveItems(uid: string, items: WishItem[]): Promise<void> {
  return setDoc(docRef(uid), { items });
}
