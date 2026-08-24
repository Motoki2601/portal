import { useState, useEffect } from 'react';

interface BaseItem {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const nextId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useCollection<T extends BaseItem>(
  uid: string,
  subscribe: (uid: string, onChange: (items: T[]) => void) => () => void,
  save: (uid: string, items: T[]) => Promise<void>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => subscribe(uid, setItems), [uid, subscribe]);

  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(false), 4000);
    return () => clearTimeout(timer);
  }, [saveError]);

  const persist = (next: T[]) => {
    setItems(next);
    save(uid, next)
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  };

  const upsert = (data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>, editItem: T | null) => {
    const now = new Date().toISOString();
    const next = editItem
      ? items.map(i => (i.id === editItem.id ? ({ ...i, ...data, updatedAt: now } as T) : i))
      : [...items, ({ ...data, id: nextId(), createdAt: now, updatedAt: now } as T)];
    persist(next);
  };

  const remove = (id: string) => {
    if (confirm('削除しますか？')) {
      persist(items.filter(i => i.id !== id));
    }
  };

  const update = (id: string, patch: Partial<T>) => {
    const now = new Date().toISOString();
    persist(items.map(i => (i.id === id ? { ...i, ...patch, updatedAt: now } : i)));
  };

  return { items, persist, upsert, remove, update, saveError };
}
