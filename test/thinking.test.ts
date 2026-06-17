import { describe, it, expect } from 'vitest';
import { streamFromChunks } from '../src/util/stream.js';
import { AnthropicAdapter, parseAnthropicStream } from '../src/providers/anthropic.js';
import type { ProviderEvent } from '../src/types/index.js';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

async function capture(opts: { thinkingBudget?: number }): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return { ok: true, status: 200, body: streamFromChunks(['data: {"type":"message_stop"}\n\n']), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
  const adapter = new AnthropicAdapter({ apiKey: 'k', fetchImpl });
  await collect(adapter.chat([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], [], { model: 'claude', temperature: 0.7, ...opts }));
  return body!;
}

describe('extended thinking (Anthropic)', () => {
  it('declares the thinking capability', () => {
    expect(new AnthropicAdapter({ apiKey: 'k' }).capabilities.thinking).toBe(true);
  });

  it('sends a thinking block and drops temperature when a budget is set', async () => {
    const body = await capture({ thinkingBudget: 2048 });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens as number).toBeGreaterThan(2048);
  });

  it('omits thinking and keeps temperature when no budget is set', async () => {
    const body = await capture({});
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.7);
  });

  it('parses thinking_delta into thinking events and ignores signature_delta', async () => {
    const chunks = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me think"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
    const events = await collect(parseAnthropicStream(streamFromChunks(chunks)));
    expect(events).toContainEqual({ type: 'thinking', text: 'let me think' });
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('answer');
  });
});
