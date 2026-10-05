import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProductAttributes } from '../product-attributes.mjs';

const item = { canonicalName: '架空 シャンプー', brand: '架空ブランド', sizeValue: 400, sizeUnit: 'ml', packageType: 'refill', packCount: 1 };
const product = (id, patch = {}) => ({ id, ...item, ...patch });
const match = (candidate = item, products = [product('a')], options = {}) => matchProductAttributes({ candidate, products, ...options });

test('unique full attributes match without mutating inputs', () => {
  const candidate = Object.freeze({ ...item }), products = [Object.freeze(product('a'))];
  assert.deepEqual(match(candidate, products), { productId: 'a', matchMethod: 'attributes', needsReview: false, methodVersion: 'product-attributes-v1' });
});
test('name and brand normalize only NFKC and whitespace', () => {
  assert.equal(match({ ...item, canonicalName: '  架空　シャンプー\n', brand: '　架空ブランド ' }).productId, 'a');
  assert.equal(match({ ...item, canonicalName: '架空シャンプー' }).productId, null);
  assert.equal(match({ ...item, canonicalName: '別名' }, [product('a', { aliases: ['別名'] })]).productId, null);
});
test('capacity, unit, packaging, pack count, brand and name differences never merge', () => {
  for (const patch of [{ sizeValue: 500 }, { sizeValue: 0.4, sizeUnit: 'l' }, { packageType: 'bottle' }, { packCount: 2 }, { brand: '別ブランド' }, { canonicalName: '別商品' }]) {
    assert.equal(match({ ...item, ...patch }).code, 'NO_ATTRIBUTE_MATCH');
  }
});
test('every missing or invalid candidate attribute is reviewable rather than equal', () => {
  for (const field of Object.keys(item)) {
    assert.equal(match({ ...item, [field]: null }).code, 'INCOMPLETE_ATTRIBUTES');
    assert(match({ ...item, [field]: undefined }).missingFields.includes(field));
  }
  for (const patch of [{ brand: 'unknown' }, { brand: '不明' }, { sizeValue: NaN }, { sizeValue: Infinity }, { sizeValue: 0 }, { packCount: 0 }, { packCount: 1.5 }]) assert.equal(match({ ...item, ...patch }).needsReview, true);
});
test('ambiguous complete or compatible incomplete products remain unmatched', () => {
  assert.deepEqual(match(item, [product('b'), product('a')]).candidateProductIds, ['a', 'b']);
  const result = match(item, [product('b', { sizeValue: null }), product('a')]);
  assert.equal(result.code, 'AMBIGUOUS_ATTRIBUTES'); assert.equal(result.productId, null);
  assert.equal(match(item, [product('a', { packCount: null })]).code, 'INCOMPLETE_CANDIDATES');
  assert.equal(match(item, [product('b', { brand: '別ブランド', sizeValue: null }), product('a')]).productId, 'a');
});
test('explicit user binding or null precedes attribute matching and missing IDs do not fall back', () => {
  assert.equal(match(item, [product('a', { sizeValue: 500 })], { explicitProductId: 'a' }).matchMethod, 'user');
  assert.equal(match(item, [product('a')], { explicitProductId: null }).code, 'USER_UNMATCHED');
  assert.equal(match(item, [product('a')], { explicitProductId: 'missing' }).code, 'USER_PRODUCT_NOT_FOUND');
});
test('existing user overrides are applied without releasing or overwriting them', () => {
  const products = [product('a', { sizeValue: 500, userOverrides: { sizeValue: { value: 400, observationId: 'anonymous-fix' } } })];
  const before = structuredClone(products);
  assert.equal(match(item, products).productId, 'a');
  assert.deepEqual(products, before);
  products[0].userOverrides.sizeValue.value = null;
  assert.equal(match(item, products).code, 'INCOMPLETE_CANDIDATES');
});
test('results are deterministic under input ordering and repeat execution', () => {
  const products = [product('b'), product('a')];
  assert.deepEqual(match(item, products), match(item, products.toReversed()));
  assert.deepEqual(match(item, products), match(item, products));
});
test('known candidate identifiers cannot bypass strong-identifier resolution through attribute fallback', () => {
  assert.equal(match({ ...item, identifiers: { merchantSku: 'anonymous-sku' } }).code, 'IDENTIFIER_RESOLUTION_REQUIRED');
  assert.equal(match({ ...item, identifiers: { merchantSku: null } }).productId, 'a');
  assert.equal(match({ ...item, identifiers: { merchantSku: 'anonymous-sku' } }, [product('a')], { explicitProductId: 'a' }).matchMethod, 'user');
});
test('duplicate IDs, malformed IDs, oversized inputs and unsupported options are rejected', () => {
  for (const products of [[product('a'), product('a')], [product('../other')], Array.from({ length: 5001 }, (_, n) => product(`p${n}`))]) assert.throws(() => match(item, products), error => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => match(item, [product('a')], { uid: 'other' }), error => error.code === 'INVALID_ARGUMENT');
});
