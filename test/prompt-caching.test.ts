import { describe, it, expect } from 'vitest';
import { streamFromChunks } from '../src/util/stream.js';
import { AnthropicAdapter, parseAnthropicStream, toAnthropicTools } from '../src/providers/anthropic.js';
import { UsageTracker } from '../src/util/usage.js';
import type { ProviderEvent, ToolDef } from '../src/types/index.js';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('Anthropic prompt caching', () => {
  it('marks the last tool with cache_control when requested', () => {
    const tools: ToolDef[] = [
      { name: 'a', description: 'a', inputSchema: {} },
      { name: 'b', description: 'b', inputSchema: {} },
    ];
    const out = toAnthropicTools(tools, true) as Array<Record<string, unknown>>;
    expect(out[0]!.cache_control).toBeUndefined();
    expect(out[1]!.cache_control).toEqual({ type: 'ephemeral' });
    // default (no caching) leaves tools unmarked
    expect((toAnthropicTools(tools) as Array<Record<string, unknown>>)[1]!.cache_control).toBeUndefined();
  });

  it('sends cache_control on the system block and the last tool', async () => {
    let body: Record<string, unknown> | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        body: streamFromChunks(['data: {"type":"message_stop"}\n\n']),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const adapter = new AnthropicAdapter({ apiKey: 'k', fetchImpl });
    await collect(
      adapter.chat([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], [{ name: 'read', description: 'r', inputSchema: {} }], {
        model: 'claude-3-5-sonnet-latest',
        system: 'be terse',
      }),
    );
    const system = body!.system as Array<Record<string, unknown>>;
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const tools = body!.tools as Array<Record<string, unknown>>;
    expect(tools[tools.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('parses cache_creation/read tokens into the usage event', async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_creation_input_tokens":100,"cache_read_input_tokens":900}}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
    const events = await collect(parseAnthropicStream(streamFromChunks(chunks)));
    const usage = events.find((e) => e.type === 'usage') as { usage: Record<string, number> };
    expect(usage.usage.cacheCreationTokens).toBe(100);
    expect(usage.usage.cacheReadTokens).toBe(900);
  });

  it('UsageTracker reports cached tokens', () => {
    const t = new UsageTracker();
    t.add({ inputTokens: 12, outputTokens: 5, cacheCreationTokens: 100, cacheReadTokens: 900 });
    expect(t.totals().cacheReadTokens).toBe(900);
    expect(t.format('claude-3-5-sonnet-latest', 'anthropic')).toContain('cache: 900 read / 100 written');
  });
});
