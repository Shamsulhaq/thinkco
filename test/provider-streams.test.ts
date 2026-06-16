import { describe, it, expect } from 'vitest';
import { streamFromChunks } from '../src/util/stream.js';
import { AnthropicAdapter, parseAnthropicStream } from '../src/providers/anthropic.js';
import { OpenAIAdapter, parseOpenAIStream } from '../src/providers/openai.js';
import { parseOllamaStream } from '../src/providers/ollama.js';
import type { ProviderEvent } from '../src/types/index.js';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function textOf(events: ProviderEvent[]): string {
  return events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
}

function mockFetch(chunks: string[], ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      body: streamFromChunks(chunks),
      text: async () => 'error body',
    }) as unknown as Response) as unknown as typeof fetch;
}

// --- Anthropic ---
describe('Anthropic stream parsing', () => {
  it('parses text + usage + stop', async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
    const events = await collect(parseAnthropicStream(streamFromChunks(chunks)));
    expect(textOf(events)).toBe('Hello world');
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });

  it('parses tool_use blocks', async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu1","name":"read"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
    const events = await collect(parseAnthropicStream(streamFromChunks(chunks)));
    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toEqual({ type: 'tool_call', call: { id: 'tu1', name: 'read', input: { path: 'a.txt' } } });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });
  });

  it('adapter throws retryable error on 429', async () => {
    const a = new AnthropicAdapter({ apiKey: 'k', fetchImpl: mockFetch([], false, 429) });
    await expect(collect(a.chat([], [], { model: 'm' }))).rejects.toMatchObject({ retryable: true });
  });
});

// --- OpenAI ---
describe('OpenAI stream parsing', () => {
  it('parses text + usage + stop', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];
    const events = await collect(parseOpenAIStream(streamFromChunks(chunks)));
    expect(textOf(events)).toBe('Hi there');
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });

  it('accumulates streamed tool call arguments', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"grep","arguments":"{\\"q\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"foo\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const events = await collect(parseOpenAIStream(streamFromChunks(chunks)));
    expect(events.find((e) => e.type === 'tool_call')).toEqual({
      type: 'tool_call',
      call: { id: 'c1', name: 'grep', input: { q: 'foo' } },
    });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });
  });

  it('adapter throws on 500', async () => {
    const o = new OpenAIAdapter({ apiKey: 'k', fetchImpl: mockFetch([], false, 500) });
    await expect(collect(o.chat([], [], { model: 'm' }))).rejects.toMatchObject({ retryable: true });
  });
});

// --- Ollama ---
describe('Ollama stream parsing', () => {
  it('parses NDJSON text + done', async () => {
    const chunks = [
      '{"message":{"role":"assistant","content":"Hey"}}\n',
      '{"message":{"role":"assistant","content":" you"}}\n',
      '{"done":true,"prompt_eval_count":4,"eval_count":3}\n',
    ];
    const events = await collect(parseOllamaStream(streamFromChunks(chunks)));
    expect(textOf(events)).toBe('Hey you');
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 4, outputTokens: 3 } });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });

  it('parses tool calls', async () => {
    const chunks = [
      '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"list","arguments":{"dir":"."}}}]}}\n',
      '{"done":true}\n',
    ];
    const events = await collect(parseOllamaStream(streamFromChunks(chunks)));
    const call = events.find((e) => e.type === 'tool_call') as { call: { name: string; input: unknown } };
    expect(call.call.name).toBe('list');
    expect(call.call.input).toEqual({ dir: '.' });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });
  });
});
