import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureKnownProvider, resolveProvider } from '../src/cli/resolve.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { loadConfig, type Config } from '../src/config/index.js';
import type { LocalProvider } from '../src/providers/local.js';

let dir: string;
function cfg(overrides: Record<string, unknown> = {}): Config {
  return loadConfig({ globalDir: dir, projectDir: dir, overrides });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-resolve-'));
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noLocal = async (): Promise<LocalProvider | null> => null;
const okModels = async () => ['m1', 'm2'];

describe('ensureKnownProvider', () => {
  it('falls back to fake for an unknown provider', () => {
    const c = cfg({ defaultProvider: 'mystery' });
    expect(ensureKnownProvider(c, new ProviderRegistry())).toBe(true);
    expect(c.defaultProvider).toBe('fake');
  });

  it('leaves a known provider unchanged', () => {
    const c = cfg({ defaultProvider: 'ollama' });
    expect(ensureKnownProvider(c, new ProviderRegistry())).toBe(false);
    expect(c.defaultProvider).toBe('ollama');
  });
});

describe('resolveProvider', () => {
  it('uses a usable configured provider', async () => {
    const c = cfg({ defaultProvider: 'fake' });
    const r = await resolveProvider(c, new ProviderRegistry(), { detectLocal: noLocal, listModels: okModels });
    expect(r.status).toBe('configured');
    expect(r.availableModels).toEqual(['m1', 'm2']);
  });

  it('detects a local LLM when the provider is unusable (no key)', async () => {
    const c = cfg({ defaultProvider: 'anthropic' }); // no key → create throws
    const local: LocalProvider = { provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['qwen', 'llama'] };
    const r = await resolveProvider(c, new ProviderRegistry(), {
      detectLocal: async () => local,
      listModels: okModels,
    });
    expect(r.status).toBe('local');
    expect(c.defaultProvider).toBe('ollama');
    expect(c.defaultModel).toBe('qwen');
    expect(c.providers.ollama?.baseUrl).toBe('http://localhost:11434');
  });

  it('keeps a saved model if the local LLM still has it', async () => {
    const c = cfg({ defaultProvider: 'anthropic', defaultModel: 'llama' });
    const local: LocalProvider = { provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['qwen', 'llama'] };
    const r = await resolveProvider(c, new ProviderRegistry(), { detectLocal: async () => local, listModels: okModels });
    expect(r.status).toBe('local');
    expect(c.defaultModel).toBe('llama'); // preserved
  });

  it('falls back to offline fake when nothing is usable', async () => {
    const c = cfg({ defaultProvider: 'anthropic' });
    const r = await resolveProvider(c, new ProviderRegistry(), { detectLocal: noLocal, listModels: okModels });
    expect(r.status).toBe('offline');
    expect(c.defaultProvider).toBe('fake');
    expect(r.requested).toBe('anthropic');
  });
});
