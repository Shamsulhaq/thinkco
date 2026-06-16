import { describe, it, expect } from 'vitest';
import { streamFromChunks } from '../src/util/stream.js';
import { AnthropicAdapter } from '../src/providers/anthropic.js';
import { OpenAIAdapter } from '../src/providers/openai.js';
import { OllamaAdapter } from '../src/providers/ollama.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { FakeProvider } from '../src/providers/fake.js';
import { loadConfig } from '../src/config/index.js';
import type { ProviderAdapter, ProviderEvent } from '../src/types/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mock(chunks: string[]): typeof fetch {
  return (async () =>
    ({ ok: true, status: 200, body: streamFromChunks(chunks), text: async () => '' }) as unknown as Response) as unknown as typeof fetch;
}

/**
 * Contract: every adapter, given a "say hello then stop" response, must produce
 * the same unified event shape — text event(s) followed by usage then stop.
 */
describe('provider contract (uniform event shape)', () => {
  const adapters: Array<{ name: string; adapter: ProviderAdapter }> = [
    {
      name: 'anthropic',
      adapter: new AnthropicAdapter({
        apiKey: 'k',
        fetchImpl: mock([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]),
      }),
    },
    {
      name: 'openai',
      adapter: new OpenAIAdapter({
        apiKey: 'k',
        fetchImpl: mock([
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
        ]),
      }),
    },
    {
      name: 'ollama',
      adapter: new OllamaAdapter({
        fetchImpl: mock([
          '{"message":{"content":"hello"}}\n',
          '{"done":true,"prompt_eval_count":1,"eval_count":1}\n',
        ]),
      }),
    },
    { name: 'fake', adapter: new FakeProvider({ script: [{ text: ['hello'] }] }) },
  ];

  for (const { name, adapter } of adapters) {
    it(`${name}: emits text then usage then stop`, async () => {
      const events = await collect(adapter.chat([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], [], { model: 'm' }));
      const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
      expect(text).toBe('hello');

      const usageIdx = events.findIndex((e) => e.type === 'usage');
      const stopIdx = events.findIndex((e) => e.type === 'stop');
      expect(usageIdx).toBeGreaterThanOrEqual(0);
      expect(stopIdx).toBe(events.length - 1);
      expect(usageIdx).toBeLessThan(stopIdx);
      expect((events[stopIdx] as { reason: string }).reason).toBe('end_turn');
    });
  }
});

describe('ProviderRegistry', () => {
  const empty = mkdtempSync(join(tmpdir(), 'thinkco-reg-'));
  const config = loadConfig({ globalDir: empty, projectDir: empty });

  it('lists builtin providers', () => {
    const r = new ProviderRegistry();
    expect(r.list().sort()).toEqual(['anthropic', 'fake', 'lmstudio', 'ollama', 'openai']);
  });

  it('creates a fake provider', () => {
    const r = new ProviderRegistry();
    const p = r.create('fake', config);
    expect(p.name).toBe('fake');
  });

  it('throws on unknown provider', () => {
    const r = new ProviderRegistry();
    expect(() => r.create('nope', config)).toThrow(/Unknown provider/);
  });

  it('resolveModel falls back to provider default', () => {
    const r = new ProviderRegistry();
    expect(r.resolveModel('openai', config)).toBe('gpt-4o');
  });

  it('resolveModel honors config defaultModel override', () => {
    const r = new ProviderRegistry();
    const c = { ...config, defaultModel: 'custom-model' };
    expect(r.resolveModel('anthropic', c)).toBe('custom-model');
  });

  it('allows registering custom providers', () => {
    const r = new ProviderRegistry();
    r.register('custom', () => new FakeProvider());
    expect(r.has('custom')).toBe(true);
  });

  it('creates a custom OpenAI-compatible provider from config baseUrl', () => {
    const r = new ProviderRegistry();
    const custom = {
      ...config,
      providers: { groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k' } },
    };
    const p = r.create('groq', custom);
    expect(p.name).toBe('openai'); // OpenAI-compatible adapter
  });

  it('registerConfiguredProviders makes custom providers known', () => {
    const r = new ProviderRegistry();
    const custom = {
      ...config,
      providers: { groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k' } },
    };
    expect(r.has('groq')).toBe(false);
    r.registerConfiguredProviders(custom);
    expect(r.has('groq')).toBe(true);
  });
});
