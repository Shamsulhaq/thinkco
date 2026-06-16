/** Provider/model resolution for startup — extracted from the entrypoint to be testable. */
import type { Config } from '../config/index.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { LocalProvider } from '../providers/local.js';

/** Ensure the configured provider is registered; fall back to 'fake' if not. Returns true if fell back. */
export function ensureKnownProvider(config: Config, registry: ProviderRegistry): boolean {
  if (registry.has(config.defaultProvider)) return false;
  config.defaultProvider = 'fake';
  return true;
}

export interface ResolveDeps {
  detectLocal: () => Promise<LocalProvider | null>;
  listModels: (provider: string, config: Config) => Promise<string[]>;
}

export interface ResolveResult {
  status: 'configured' | 'local' | 'offline';
  availableModels: string[];
  /** The provider originally requested before any fallback. */
  requested: string;
  local?: LocalProvider;
}

/**
 * Resolve a usable provider for startup. If the configured provider can be created (has
 * credentials), use it. Otherwise detect a local LLM (Ollama/LM Studio), else fall back to 'fake'.
 * Mutates `config.defaultProvider`/`defaultModel`/`providers` to reflect the resolution.
 */
export async function resolveProvider(
  config: Config,
  registry: ProviderRegistry,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const requested = config.defaultProvider;
  try {
    registry.create(config.defaultProvider, config);
    const availableModels = await deps.listModels(config.defaultProvider, config);
    return { status: 'configured', availableModels, requested };
  } catch {
    const local = await deps.detectLocal();
    if (local) {
      const saved = config.defaultModel;
      const model = saved && local.models.includes(saved) ? saved : local.models[0]!;
      config.defaultProvider = local.provider;
      config.defaultModel = model;
      config.providers[local.provider] = { ...config.providers[local.provider], baseUrl: local.baseUrl };
      return { status: 'local', availableModels: local.models, requested, local };
    }
    config.defaultProvider = 'fake';
    return { status: 'offline', availableModels: [], requested };
  }
}
