import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCollectionOperation, canMutateCollection } from '../src/collectionOperations.ts';

const item = (id, name = id, updatedAt = 'v1') => ({ id, name, purchased: false, createdAt: 'created', updatedAt });
test('initial, cached, failed and other-user snapshots cannot authorize writes', () => {
  for (const session of [
    { uid: 'owner', ready: false, error: false },
    { uid: 'owner', ready: true, error: true },
    { uid: 'other', ready: true, error: false },
  ]) assert.equal(canMutateCollection(session, 'owner'), false);
  assert.equal(canMutateCollection({ uid: 'owner', ready: true, error: false }, 'owner'), true);
});
test('separate additions applied to latest data preserve both devices changes', () => {
  const first = applyCollectionOperation([item('a')], { kind: 'add', item: item('b') });
  const retried = applyCollectionOperation(first, { kind: 'add', item: item('c') });
  assert.deepEqual(retried.map(x => x.id), ['a', 'b', 'c']);
});
test('editing one item preserves a concurrent addition and immutable metadata', () => {
  const result = applyCollectionOperation([item('a'), item('b')], {
    kind: 'edit', id: 'a', expectedUpdatedAt: 'v1',
    data: { name: 'edited', purchased: false }, updatedAt: 'v2',
  });
  assert.deepEqual(result, [item('a', 'edited', 'v2'), item('b')]);
});
test('stale edit, stale deletion and editing a deleted item fail instead of overwriting', () => {
  const operation = { kind: 'edit', id: 'a', expectedUpdatedAt: 'v1', data: { name: 'stale', purchased: false }, updatedAt: 'v3' };
  assert.throws(() => applyCollectionOperation([item('a', 'new', 'v2')], operation), /changed/);
  assert.throws(() => applyCollectionOperation([item('a', 'new', 'v2')], { kind: 'remove', id: 'a', expectedUpdatedAt: 'v1' }), /changed/);
  assert.throws(() => applyCollectionOperation([], operation), /no longer/);
});
test('status updates preserve concurrent field edits and deletion preserves other additions', () => {
  const updated = applyCollectionOperation([item('a', 'new', 'v2'), item('b')], { kind: 'update', id: 'a', patch: { purchased: true }, updatedAt: 'v3' });
  assert.equal(updated[0].name, 'new');
  assert.equal(updated[0].purchased, true);
  assert.deepEqual(applyCollectionOperation(updated, { kind: 'remove', id: 'a', expectedUpdatedAt: 'v3' }), [item('b')]);
});
test('duplicate add fails and reducer does not mutate the subscribed array', () => {
  const original = [item('a')];
  assert.throws(() => applyCollectionOperation(original, { kind: 'add', item: item('a') }), /Duplicate/);
  applyCollectionOperation(original, { kind: 'update', id: 'a', patch: { purchased: true }, updatedAt: 'v2' });
  assert.deepEqual(original, [item('a')]);
});
