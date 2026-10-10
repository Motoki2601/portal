import { createHash } from 'node:crypto';
import { validateAiRuntimeConfig } from './runtime-config.mjs';

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid billable count');
  return BigInt(value);
}
// Integer micro-JPY, rounded upward once. BigInt avoids floating-point loss and
// intermediate overflow. No discounts/free shared quota are assumed.
export function calculateAiCostMicros(config, { inputTokens, outputTokens, searchQueries }) {
  const rates = validateAiRuntimeConfig(config);
  const tokenUsd = count(inputTokens) * BigInt(rates.inputUsdMicrosPerMillion) + count(outputTokens) * BigInt(rates.outputUsdMicrosPerMillion);
  const searchUsd = count(searchQueries) * BigInt(rates.searchUsdMicrosPerQuery) * 1000000n;
  const numerator = (tokenUsd + searchUsd) * BigInt(rates.jpyMicrosPerUsd);
  const cost = (numerator + 1000000000000n - 1n) / 1000000000000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Cost outside safe ledger range');
  return Number(cost);
}

// Evidence strings are operator/adapter assertions, not automatic proof. The
// adapter must enforce these bounds on the actual request, including thinking.
export function createAiCostReservation(config, { maxInputTokens, maxOutputTokens, maxSearchQueries, tokenBoundEvidence, searchBoundEvidence }) {
  const rates = validateAiRuntimeConfig(config);
  count(maxInputTokens); count(maxOutputTokens); count(maxSearchQueries);
  if (!maxInputTokens || !maxOutputTokens || maxInputTokens > 1048576 || maxOutputTokens > 65536 || typeof tokenBoundEvidence !== 'string' || !tokenBoundEvidence.trim()) throw new Error('Verified total token bounds required');
  if (maxSearchQueries > 0 && (typeof searchBoundEvidence !== 'string' || !searchBoundEvidence.trim())) throw new Error('Verified search query bound required');
  const upperBoundJpyMicro = calculateAiCostMicros(rates, { inputTokens: maxInputTokens, outputTokens: maxOutputTokens, searchQueries: maxSearchQueries });
  const pricingVersion = createHash('sha256').update(JSON.stringify([
    rates.pricingVersion, rates.jpyMicrosPerUsd, rates.inputUsdMicrosPerMillion, rates.outputUsdMicrosPerMillion, rates.searchUsdMicrosPerQuery,
    maxInputTokens, maxOutputTokens, maxSearchQueries, tokenBoundEvidence, searchBoundEvidence ?? null,
  ])).digest('hex');
  return Object.freeze({ kind: maxSearchQueries ? 'search' : 'ai', model: rates.model, upperBoundJpyMicro, pricingVersion, hardBoundVerified: true });
}
