/** Curated provider presets for the /login flow (id → base URL / key requirements). */

export interface ProviderPreset {
  id: string;
  label: string;
  /** OpenAI-compatible base URL (for non-native providers). */
  baseUrl?: string;
  needsKey: boolean;
  /** True if a built-in adapter handles this provider (anthropic/openai/gemini/ollama/lmstudio). */
  native: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, native: true },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, native: true },
  { id: 'gemini', label: 'Google Gemini', needsKey: true, native: true },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, native: false },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, native: false },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', needsKey: true, native: false },
  { id: 'opencode zen', label: 'opencode zen', baseUrl: 'https://opencode.ai/zen/v1', needsKey: true, native: false },
  { id: 'opencode go', label: 'opencode go', baseUrl: 'https://opencode.ai/zen/go/v1', needsKey: true, native: false },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434', needsKey: false, native: true },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', needsKey: false, native: true },
];

export const CUSTOM_PRESET_LABEL = 'custom (other OpenAI-compatible)';
