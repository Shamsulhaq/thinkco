import { describe, it, expect } from 'vitest';
import { probeOllama, probeLmStudio, detectLocalProvider, listModels } from '../src/providers/local.js';
import { loadConfig } from '../src/config/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cfg = () => {
  const d = mkdtempSync(join(tmpdir(), 'thinkco-local-'));
  return loadConfig({ globalDir: d, projectDir: d });
};

function fetchReturning(map: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    if (!key) throw new Error('connection refused');
    return { ok: true, status: 200, json: async () => map[key] } as unknown as Response;
  }) as unknown as typeof fetch;
}

const fetchRefused: typeof fetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

describe('local LLM detection', () => {
  it('probeOllama returns model names', async () => {
    const f = fetchReturning({ '/api/tags': { models: [{ name: 'llama3.1' }, { name: 'qwen2.5' }] } });
    expect(await probeOllama(f)).toEqual(['llama3.1', 'qwen2.5']);
  });

  it('probeOllama returns null when unreachable', async () => {
    expect(await probeOllama(fetchRefused)).toBeNull();
  });

  it('probeLmStudio returns model ids', async () => {
    const f = fetchReturning({ '/models': { data: [{ id: 'mistral-7b' }] } });
    expect(await probeLmStudio(f)).toEqual(['mistral-7b']);
  });

  it('detectLocalProvider prefers Ollama when both are up', async () => {
    const f = fetchReturning({
      '/api/tags': { models: [{ name: 'llama3.1' }] },
      '/models': { data: [{ id: 'mistral-7b' }] },
    });
    const local = await detectLocalProvider(f);
    expect(local?.provider).toBe('ollama');
    expect(local?.models).toEqual(['llama3.1']);
  });

  it('detectLocalProvider falls back to LM Studio when Ollama is down', async () => {
    const f = (async (url: string) => {
      if (String(url).includes('/api/tags')) throw new Error('refused');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'mistral-7b' }] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const local = await detectLocalProvider(f);
    expect(local?.provider).toBe('lmstudio');
    expect(local?.models).toEqual(['mistral-7b']);
  });

  it('detectLocalProvider returns null when nothing is running', async () => {
    expect(await detectLocalProvider(fetchRefused)).toBeNull();
  });

  it('listModels fetches ollama tags', async () => {
    const f = fetchReturning({ '/api/tags': { models: [{ name: 'phi3' }] } });
    expect(await listModels('ollama', cfg(), f)).toEqual(['phi3']);
  });

  it('listModels returns known models for anthropic', async () => {
    const models = await listModels('anthropic', cfg(), fetchRefused);
    expect(models).toContain('claude-3-5-sonnet-latest');
  });
});
