export function validateSecretReference(value) {
  if (typeof value !== 'string' || !/^projects\/(?:[a-z][a-z0-9-]{4,61}[a-z0-9]|[1-9][0-9]{0,19})\/secrets\/[A-Za-z0-9_-]{1,255}\/versions\/[1-9][0-9]*$/.test(value)) throw new Error('Invalid pinned Secret reference');
  return value;
}
// No credentials are retrieved here. Caller passes references, never secret values.
export function validateAiRuntimeConfig({ model, apiKeySecret, pricingVersion, jpyMicrosPerUsd, inputUsdMicrosPerMillion, outputUsdMicrosPerMillion, searchUsdMicrosPerQuery }) {
  if (model !== 'gemini-3.5-flash-lite') throw new Error('Configured model must match approved model');
  validateSecretReference(apiKeySecret);
  if (typeof pricingVersion !== 'string' || !pricingVersion.trim()) throw new Error('Pricing evidence required');
  for (const value of [jpyMicrosPerUsd, inputUsdMicrosPerMillion, outputUsdMicrosPerMillion, searchUsdMicrosPerQuery]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Positive verified pricing and FX required');
  }
  return Object.freeze({ model, apiKeySecret, pricingVersion, jpyMicrosPerUsd, inputUsdMicrosPerMillion, outputUsdMicrosPerMillion, searchUsdMicrosPerQuery });
}
