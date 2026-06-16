/** Provider registry: instantiate adapters from config and select models. */
import type { ProviderAdapter } from '../types/index.js';
import type { Config } from '../config/index.js';
import { ProviderError } from '../util/errors.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { OllamaAdapter } from './ollama.js';
import { FakeProvider } from './fake.js';

export type ProviderFactory = (config: Config) => ProviderAdapter;

/** Default model per provider when none is specified. */
export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-3-5-sonnet-latest',
  openai: 'gpt-4o',
  ollama: 'llama3.1',
  lmstudio: 'local-model',
  fake: 'fake-1',
};

const BUILTIN_FACTORIES: Record<string, ProviderFactory> = {
  anthropic: (config) => {
    const p = config.providers.anthropic ?? {};
    return new AnthropicAdapter({ apiKey: p.apiKey ?? '', baseUrl: p.baseUrl });
  },
  openai: (config) => {
    const p = config.providers.openai ?? {};
    return new OpenAIAdapter({ apiKey: p.apiKey ?? '', baseUrl: p.baseUrl });
  },
  ollama: (config) => {
    const p = config.providers.ollama ?? {};
    return new OllamaAdapter({ baseUrl: p.baseUrl });
  },
  lmstudio: (config) => {
    // LM Studio exposes an OpenAI-compatible API; no real key needed.
    const p = config.providers.lmstudio ?? {};
    return new OpenAIAdapter({ apiKey: p.apiKey ?? 'lm-studio', baseUrl: p.baseUrl ?? 'http://localhost:1234/v1' });
  },
  fake: () => new FakeProvider(),
};

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  constructor(factories: Record<string, ProviderFactory> = BUILTIN_FACTORIES) {
    for (const [name, factory] of Object.entries(factories)) {
      this.factories.set(name, factory);
    }
  }

  register(name: string, factory: ProviderFactory): void {
    this.factories.set(name, factory);
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  list(): string[] {
    return [...this.factories.keys()];
  }

  /** Create an adapter instance for the given provider name. */
  create(name: string, config: Config): ProviderAdapter {
    const factory = this.factories.get(name);
    if (factory) return factory(config);
    // Custom OpenAI-compatible provider declared in config (baseUrl present).
    const pc = config.providers[name];
    if (pc?.baseUrl) {
      return new OpenAIAdapter({ apiKey: pc.apiKey ?? 'none', baseUrl: pc.baseUrl });
    }
    throw new ProviderError(
      `Unknown provider "${name}". Available: ${this.list().join(', ')}`,
      false,
    );
  }

  /**
   * Register any custom providers declared in config (non-builtin entries with a baseUrl) as
   * OpenAI-compatible adapters, so has()/startup recognize them across launches.
   */
  registerConfiguredProviders(config: Config): void {
    for (const [name, pc] of Object.entries(config.providers)) {
      if (!this.factories.has(name) && pc?.baseUrl) {
        this.register(name, (cfg) => {
          const p = cfg.providers[name] ?? {};
          return new OpenAIAdapter({ apiKey: p.apiKey ?? 'none', baseUrl: p.baseUrl ?? pc.baseUrl });
        });
      }
    }
  }

  /** Resolve the model id: explicit override > config default > provider default. */
  resolveModel(providerName: string, config: Config): string {
    return (
      config.defaultModel ??
      config.providers[providerName]?.defaultModel ??
      DEFAULT_MODELS[providerName] ??
      'default'
    );
  }
}

export const defaultRegistry = new ProviderRegistry();
