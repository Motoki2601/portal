import { BUDGET_FALLBACK, createAiBudgetGate } from './ai-budget.mjs';
import { createPinnedSecretReader } from './secret-reader.mjs';
import { createBudgetedGeminiProvider } from './gemini-provider.mjs';

// Default-off composition. Bad optional AI configuration must not prevent
// history/replenishment/non-AI operations from starting.
export function createOptionalAiRuntime({ db, env = process.env, credential, fetchImpl = fetch, clock }) {
  const unavailable = code => Object.freeze({
    enabled: false, code,
    call: async () => ({ allowed: false, code, fallback: BUDGET_FALLBACK }),
  });
  if (env.AI_RUNTIME_ENABLED !== 'true') return unavailable('AI_DISABLED');
  try {
    const config = JSON.parse(env.AI_RUNTIME_CONFIG_JSON);
    const reader = createPinnedSecretReader({ allowedReferences: [config.apiKeySecret], credential, fetchImpl });
    const gate = createAiBudgetGate(db, { clock });
    const call = createBudgetedGeminiProvider({ gate, config, readSecret: reader, fetchImpl });
    return Object.freeze({ enabled: true, call });
  } catch { return unavailable('AI_CONFIGURATION_INVALID'); }
}
