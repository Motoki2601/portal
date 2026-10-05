import { useState, useEffect, useRef } from 'react';
import { canMutateCollection, type BaseItem, type CollectionOperation, type CollectionSnapshot } from '../collectionOperations';

const nextId = () => crypto.randomUUID();

export function useCollection<T extends BaseItem>(
  uid: string,
  subscribe: (uid: string, onChange: (snapshot: CollectionSnapshot<T>) => void, onError: () => void) => () => void,
  save: (uid: string, operation: CollectionOperation<T>) => Promise<void>,
) {
  const [snapshot, setSnapshot] = useState({ uid, items: [] as T[], ready: false, error: false });
  const session = useRef({ uid, ready: false, error: false });
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    session.current = { uid, ready: false, error: false };
    const unsubscribe = subscribe(uid, next => {
      if (!active) return;
      session.current = { uid, ready: next.ready, error: false };
      setSnapshot({ uid, ...next, error: false });
    }, () => {
      if (!active) return;
      session.current = { uid, ready: false, error: true };
      setSnapshot(previous => ({ ...previous, uid, ready: false, error: true }));
    });
    return () => { active = false; session.current.ready = false; unsubscribe(); };
  }, [uid, subscribe]);

  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(false), 4000);
    return () => clearTimeout(timer);
  }, [saveError]);

  const items = snapshot.uid === uid ? snapshot.items : [];
  const persist = async (operation: CollectionOperation<T>): Promise<boolean> => {
    if (!canMutateCollection(session.current, uid)) {
      setSaveError(true);
      return false;
    }
    try {
      await save(uid, operation);
      setSaveError(false);
      return true;
    } catch {
      setSaveError(true);
      return false;
    }
  };

  const upsert = (data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>, editItem: T | null) => {
    const now = new Date().toISOString();
    return persist(editItem
      ? { kind: 'edit', id: editItem.id, expectedUpdatedAt: editItem.updatedAt, data, updatedAt: now }
      : { kind: 'add', item: { ...data, id: nextId(), createdAt: now, updatedAt: now } as T });
  };
  const remove = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item && confirm('削除しますか？')) {
      void persist({ kind: 'remove', id, expectedUpdatedAt: item.updatedAt });
    }
  };
  const update = (id: string, patch: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>) => {
    void persist({ kind: 'update', id, patch, updatedAt: new Date().toISOString() });
  };

  return { items, upsert, remove, update, saveError,
    ready: snapshot.uid === uid && snapshot.ready && !snapshot.error,
    loadError: snapshot.uid === uid && snapshot.error };
}
