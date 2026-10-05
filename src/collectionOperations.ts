export interface BaseItem { id: string; createdAt: string; updatedAt: string }
export type CollectionOperation<T extends BaseItem> =
  | { kind: 'add'; item: T }
  | { kind: 'edit'; id: string; expectedUpdatedAt: string; data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>; updatedAt: string }
  | { kind: 'remove'; id: string; expectedUpdatedAt: string }
  | { kind: 'update'; id: string; patch: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>; updatedAt: string };

export function applyCollectionOperation<T extends BaseItem>(items: T[], operation: CollectionOperation<T>): T[] {
  if (operation.kind === 'add') {
    if (items.some(item => item.id === operation.item.id)) throw new Error('Duplicate item');
    return [...items, operation.item];
  }
  const current = items.find(item => item.id === operation.id);
  if (!current) throw new Error('Item no longer exists');
  if (operation.kind !== 'update' && current.updatedAt !== operation.expectedUpdatedAt) {
    throw new Error('Item changed on another device');
  }
  if (operation.kind === 'remove') return items.filter(item => item.id !== operation.id);
  return items.map(item => item.id !== operation.id ? item : {
    ...item,
    ...(operation.kind === 'edit' ? operation.data : operation.patch),
    updatedAt: operation.updatedAt,
  } as T);
}

export interface CollectionSnapshot<T> {
  items: T[];
  ready: boolean;
}

export function canMutateCollection(session: { uid: string; ready: boolean; error: boolean }, uid: string): boolean {
  return session.uid === uid && session.ready && !session.error;
}
