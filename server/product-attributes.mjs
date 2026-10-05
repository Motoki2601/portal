import { effective, id, invalid } from './application.mjs';

const fields = ['canonicalName', 'brand', 'sizeValue', 'sizeUnit', 'packageType', 'packCount'];
// Candidate discovery only: no aliases, unit conversion or fuzzy similarity can
// turn an unknown attribute into a confirmed identity.
function normalized(value) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return !text || ['unknown', '不明'].includes(text.toLowerCase()) ? null : text;
}
function attributes(value) {
  const item = effective(value);
  const result = Object.fromEntries(fields.map(field => [field,
    field === 'sizeValue' ? (typeof item[field] === 'number' && Number.isFinite(item[field]) && item[field] > 0 ? item[field] : null) :
    field === 'packCount' ? (Number.isSafeInteger(item[field]) && item[field] > 0 ? item[field] : null) : normalized(item[field]),
  ]));
  return { values: result, missing: fields.filter(field => result[field] === null) };
}

// Read-only fallback after strong identifier resolution. Input uses the existing
// Product attributes; caller owns AI extraction, tenant scope and persistence.
// explicitProductId must be supplied only from a verified user override.
export function matchProductAttributes({ candidate, products, ...options }) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !Array.isArray(products) || products.length > 5000 || Object.keys(options).some(key => key !== 'explicitProductId')) throw invalid('Invalid product matching input');
  const productIds = new Set();
  for (const product of products) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) throw invalid('Invalid product');
    id(product.id, 'product id');
    if (productIds.has(product.id)) throw invalid('Duplicate product id');
    productIds.add(product.id);
  }
  const review = (code, extras = {}) => ({ productId: null, matchMethod: 'unmatched', needsReview: true, code, methodVersion: 'product-attributes-v1', ...extras });
  if (Object.hasOwn(options, 'explicitProductId')) {
    if (options.explicitProductId === null) return review('USER_UNMATCHED');
    id(options.explicitProductId, 'explicit product id');
    if (!productIds.has(options.explicitProductId)) return review('USER_PRODUCT_NOT_FOUND');
    return { productId: options.explicitProductId, matchMethod: 'user', needsReview: false, methodVersion: 'product-attributes-v1' };
  }
  const identifiers = effective(candidate).identifiers;
  if (identifiers != null) {
    if (typeof identifiers !== 'object' || Array.isArray(identifiers)) throw invalid('Invalid product identifiers');
    if (Object.values(identifiers).some(value => value !== null && value !== undefined && value !== '')) return review('IDENTIFIER_RESOLUTION_REQUIRED');
  }
  const input = attributes(candidate);
  if (input.missing.length) return review('INCOMPLETE_ATTRIBUTES', { missingFields: input.missing });
  const exact = [], incomplete = [];
  for (const product of products) {
    const other = attributes(product);
    if (other.missing.length) {
      // A partial record with no known contradiction may describe the same
      // product. Do not pick a complete record while such ambiguity remains.
      if (fields.every(field => other.values[field] === null || other.values[field] === input.values[field])) incomplete.push(product.id);
    } else if (fields.every(field => other.values[field] === input.values[field])) exact.push(product.id);
  }
  exact.sort(); incomplete.sort();
  if (exact.length > 1 || (exact.length && incomplete.length)) return review('AMBIGUOUS_ATTRIBUTES', { candidateProductIds: [...exact, ...incomplete].sort() });
  if (!exact.length) return review(incomplete.length ? 'INCOMPLETE_CANDIDATES' : 'NO_ATTRIBUTE_MATCH', { candidateProductIds: incomplete });
  return { productId: exact[0], matchMethod: 'attributes', needsReview: false, methodVersion: 'product-attributes-v1' };
}
