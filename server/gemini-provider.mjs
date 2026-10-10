import { createBudgetedProvider } from './budgeted-provider.mjs';
import { calculateAiCostMicros, createAiCostReservation } from './ai-pricing.mjs';
import { validateAiRuntimeConfig } from './runtime-config.mjs';

// Model context maximum is reserved, rather than relying on character counts.
// max_output_tokens is a hard cutoff including thoughts in Interactions API.
export const GEMINI_INPUT_BOUND = 1048576;
export const GEMINI_OUTPUT_BOUND = 4096;
const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const fail = () => new Error('Gemini result unavailable');
const integer = n => Number.isSafeInteger(n) && n >= 0;

function bounded(promise, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(fail());
    if (signal.aborted) { stop(); return; }
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(fail()); else resolve(value);
    }, () => { signal.removeEventListener('abort', stop); reject(fail()); });
  });
}
async function readJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw fail();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await bounded(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw fail();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
function requestFor(input, config) {
  // Trusted server input only. No API/provider/model/price overrides or tools.
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some(k => !['input', 'systemInstruction'].includes(k)) ||
      typeof input.input !== 'string' || !input.input.trim() ||
      (input.systemInstruction !== undefined && typeof input.systemInstruction !== 'string')) throw fail();
  const request = {
    model: config.model, input: input.input,
    ...(input.systemInstruction === undefined ? {} : { system_instruction: input.systemInstruction }),
    generation_config: { max_output_tokens: GEMINI_OUTPUT_BOUND, thinking_level: 'minimal' },
    store: false, stream: false,
  };
  if (Buffer.byteLength(JSON.stringify(request)) > 65536) throw fail();
  return request;
}
function costFor(response, config) {
  if (response?.model !== config.model || !response.usage) throw fail();
  const usage = response.usage;
  const { total_input_tokens: input, total_output_tokens: output, total_thought_tokens: thoughts, total_tokens: total } = usage;
  if (![input, output, thoughts, total].every(integer) || total !== input + output + thoughts) throw fail();
  if (usage.total_cached_tokens !== undefined && (!integer(usage.total_cached_tokens) || usage.total_cached_tokens > input)) throw fail();
  // No built-in tool calls, grounding, or multimodal billable units are allowed.
  if (usage.total_tool_use_tokens !== undefined && usage.total_tool_use_tokens !== 0) throw fail();
  if (usage.grounding_tool_counts !== undefined &&
      (!Array.isArray(usage.grounding_tool_counts) || usage.grounding_tool_counts.length)) throw fail();
  for (const field of ['input_tokens_by_modality', 'output_tokens_by_modality']) {
    if (usage[field] !== undefined && (!Array.isArray(usage[field]) || usage[field].some(x => x.modality !== 'text' || !integer(x.tokens)))) throw fail();
  }
  // Use undiscounted input price even if implicit caching occurs: conservative
  // accounting, not an invoice reconciliation. Never assume a free quota.
  return calculateAiCostMicros(config, { inputTokens: input, outputTokens: output + thoughts, searchQueries: 0 });
}
function valueFor(response) {
  if (!['completed', 'incomplete'].includes(response.status) || !Array.isArray(response.steps)) throw fail();
  let text = '';
  for (const step of response.steps) {
    if (step.type === 'thought') continue;
    if (step.type !== 'model_output' || !Array.isArray(step.content)) throw fail();
    for (const part of step.content) {
      if (part.type !== 'text' || typeof part.text !== 'string') throw fail();
      text += part.text;
    }
  }
  // An incomplete/empty generation can still incur a known cost: settle first.
  if (response.status === 'incomplete' || !text.trim() || text.length > 16000) return { status: 'incomplete', text: null };
  return { status: 'completed', text };
}

// No construction-time network request. readSecret must be a server-pinned
// reader. This first adapter handles text only, not raw email sanitization,
// function orchestration, search, or a browser-supplied provider request.
export function createBudgetedGeminiProvider({ gate, config, readSecret, fetchImpl = fetch, timeoutMs = 20000 }) {
  const rates = validateAiRuntimeConfig(config);
  if (typeof readSecret !== 'function' || typeof fetchImpl !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw fail();
  const cost = createAiCostReservation(rates, {
    maxInputTokens: GEMINI_INPUT_BOUND, maxOutputTokens: GEMINI_OUTPUT_BOUND, maxSearchQueries: 0,
    tokenBoundEvidence: 'gemini-3.5-flash-lite-model-context-limit+interactions-hard-max-output-including-thoughts;2026-10-10',
  });
  return createBudgetedProvider({
    gate,
    prepare: async input => ({ request: requestFor(input, rates), cost }),
    dispatch: async (request, { signal }) => {
      const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const bytes = await bounded(readSecret(rates.apiKeySecret, { signal: active }), active);
      if (!Buffer.isBuffer(bytes) || !/^[A-Za-z0-9_-]{16,256}$/.test(bytes.toString('utf8'))) {
        if (Buffer.isBuffer(bytes)) bytes.fill(0);
        throw fail();
      }
      try {
        if (active.aborted) throw fail();
        const response = await bounded(fetchImpl(endpoint, {
          method: 'POST', redirect: 'error', signal: active,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': bytes.toString('utf8') },
          body: JSON.stringify(request),
        }), active);
        if (!response.ok) { await response.body?.cancel().catch(() => {}); throw fail(); }
        const result = await readJson(response, active);
        const actualJpyMicro = costFor(result, rates);
        const value = valueFor(result);
        // An observed provider-bound violation must reach settle to block the
        // ledger globally. Never hide known overrun inside an "unknown" result.
        if (result.usage.total_input_tokens > GEMINI_INPUT_BOUND ||
            result.usage.total_output_tokens + result.usage.total_thought_tokens > GEMINI_OUTPUT_BOUND) {
          await gate.blockForBoundViolation();
          return { value: { status: 'incomplete', text: null, code: 'PROVIDER_BOUND_VIOLATION' }, actualJpyMicro };
        }
        return { value, actualJpyMicro };
      } finally { bytes.fill(0); }
    },
  });
}
