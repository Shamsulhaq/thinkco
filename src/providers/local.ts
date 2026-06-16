/** Detect locally running LLM servers (Ollama, LM Studio) and list their models. */
import type { Config } from '../config/index.js';

export interface LocalProvider {
  /** Provider name registered in the ProviderRegistry. */
  provider: 'ollama' | 'lmstudio';
  baseUrl: string;
  models: string[];
}

const OLLAMA_DEFAULT = 'http://localhost:11434';
const LMSTUDIO_DEFAULT = 'http://localhost:1234/v1';

function timeoutSignal(ms: number): AbortSignal {
  // Node >=17.3 has AbortSignal.timeout.
  return AbortSignal.timeout(ms);
}

/** Probe Ollama's /api/tags. Returns model names or null if unreachable. */
export async function probeOllama(
  fetchImpl: typeof fetch = fetch,
  baseUrl = OLLAMA_DEFAULT,
  timeoutMs = 700,
): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: timeoutSignal(timeoutMs) });
    if (!res.ok) return null;
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/** Probe LM Studio's OpenAI-compatible /models. Returns model ids or null if unreachable. */
export async function probeLmStudio(
  fetchImpl: typeof fetch = fetch,
  baseUrl = LMSTUDIO_DEFAULT,
  timeoutMs = 700,
): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${baseUrl}/models`, { signal: timeoutSignal(timeoutMs) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((m) => m.id);
  } catch {
    return null;
  }
}

/**
 * Detect a usable local LLM. Prefers Ollama, then LM Studio. Returns the first one
 * that is reachable and has at least one model.
 */
export async function detectLocalProvider(fetchImpl: typeof fetch = fetch): Promise<LocalProvider | null> {
  const ollama = await probeOllama(fetchImpl);
  if (ollama && ollama.length) return { provider: 'ollama', baseUrl: OLLAMA_DEFAULT, models: ollama };

  const lmstudio = await probeLmStudio(fetchImpl);
  if (lmstudio && lmstudio.length) return { provider: 'lmstudio', baseUrl: LMSTUDIO_DEFAULT, models: lmstudio };

  return null;
}

/** Known fallback models for providers without a discovery endpoint. */
const KNOWN_MODELS: Record<string, string[]> = {
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  fake: ['fake-1'],
};

/** List available models for a provider (live where possible). */
export async function listModels(
  provider: string,
  config: Config,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const pc = config.providers[provider] ?? {};
  if (provider === 'ollama') {
    return (await probeOllama(fetchImpl, pc.baseUrl ?? OLLAMA_DEFAULT)) ?? [];
  }
  if (provider === 'lmstudio') {
    return (await probeLmStudio(fetchImpl, pc.baseUrl ?? LMSTUDIO_DEFAULT)) ?? [];
  }
  // OpenAI and any OpenAI-compatible provider (custom baseUrl): GET <baseUrl>/models.
  const baseUrl = pc.baseUrl ?? (provider === 'openai' ? 'https://api.openai.com/v1' : undefined);
  if (baseUrl) {
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: pc.apiKey ? { authorization: `Bearer ${pc.apiKey}` } : {},
        signal: timeoutSignal(4000),
      });
      if (!res.ok) return KNOWN_MODELS[provider] ?? [];
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = (json.data ?? []).map((m) => m.id).sort();
      return ids.length ? ids : (KNOWN_MODELS[provider] ?? []);
    } catch {
      return KNOWN_MODELS[provider] ?? [];
    }
  }
  return KNOWN_MODELS[provider] ?? [];
}
