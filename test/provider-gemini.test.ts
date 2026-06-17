import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { streamFromChunks } from '../src/util/stream.js';
import {
  GeminiAdapter,
  parseGeminiStream,
  toGeminiContents,
  toGeminiTools,
  mapGeminiStop,
} from '../src/providers/gemini.js';
import { AgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { RecordingSink } from '../src/agent/output.js';
import type { Message, ProviderEvent, ToolDef } from '../src/types/index.js';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function textOf(events: ProviderEvent[]): string {
  return events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
}

// --- Task 1: message & tool mapping ---
describe('Gemini message/tool mapping', () => {
  it('maps system into a separate instruction and user/model turns', () => {
    const messages: Message[] = [
      { role: 'system', content: [{ type: 'text', text: 'be terse' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const { system, contents } = toGeminiContents(messages);
    expect(system).toBe('be terse');
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi' }] },
    ]);
  });

  it('maps assistant tool_use to functionCall and tool_result to functionResponse by name', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'read it' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu1', name: 'read', input: { path: 'a.txt' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'tu1', content: 'file body' }],
      },
    ];
    const { contents } = toGeminiContents(messages);
    expect(contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'read', args: { path: 'a.txt' } } }],
    });
    // The function response is matched back to the tool name, not the id.
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'read', response: { output: 'file body' } } }],
    });
  });

  it('marks error tool results in the function response', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'shell', input: {} }] },
      { role: 'tool', content: [{ type: 'tool_result', toolUseId: 't', content: 'boom', isError: true }] },
    ];
    const { contents } = toGeminiContents(messages);
    expect(contents[1]!.parts[0]).toEqual({
      functionResponse: { name: 'shell', response: { error: 'boom' } },
    });
  });

  it('wraps tools as functionDeclarations', () => {
    const tools: ToolDef[] = [
      { name: 'read', description: 'read a file', inputSchema: { type: 'object', properties: {} } },
    ];
    expect(toGeminiTools(tools)).toEqual([
      {
        functionDeclarations: [
          { name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} } },
        ],
      },
    ]);
    expect(toGeminiTools([])).toEqual([]);
  });

  it('maps finish reasons', () => {
    expect(mapGeminiStop('STOP')).toBe('end_turn');
    expect(mapGeminiStop('MAX_TOKENS')).toBe('max_tokens');
    expect(mapGeminiStop(undefined)).toBe('end_turn');
  });
});

// --- Task 2: stream parsing ---
describe('Gemini stream parsing', () => {
  it('parses text + usage + stop', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n',
    ];
    const events = await collect(parseGeminiStream(streamFromChunks(chunks)));
    expect(textOf(events)).toBe('Hello world');
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });

  it('parses functionCall parts into tool_call events', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"grep","args":{"q":"foo"}}}]},"finishReason":"STOP"}]}\n\n',
    ];
    const events = await collect(parseGeminiStream(streamFromChunks(chunks)));
    const call = events.find((e) => e.type === 'tool_call') as
      | { call: { name: string; input: unknown } }
      | undefined;
    expect(call?.call.name).toBe('grep');
    expect(call?.call.input).toEqual({ q: 'foo' });
    // A turn that produced a tool call reports tool_use, not end_turn.
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });
  });
});

// --- Task 3: adapter class ---
describe('GeminiAdapter', () => {
  it('requires an API key', () => {
    expect(() => new GeminiAdapter({ apiKey: '' })).toThrow(/API key/);
  });

  it('posts to streamGenerateContent with the api key header and streams events', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        body: streamFromChunks([
          'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"hi"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1}}\n\n',
        ]),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const adapter = new GeminiAdapter({ apiKey: 'secret', fetchImpl });
    const events = await collect(
      adapter.chat([{ role: 'user', content: [{ type: 'text', text: 'hey' }] }], [], {
        model: 'gemini-1.5-pro',
        system: 'be nice',
      }),
    );

    expect(captured?.url).toContain('/models/gemini-1.5-pro:streamGenerateContent?alt=sse');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('secret');
    const sentBody = JSON.parse(captured?.init.body as string);
    expect(sentBody.systemInstruction).toEqual({ parts: [{ text: 'be nice' }] });
    expect(sentBody.contents).toEqual([{ role: 'user', parts: [{ text: 'hey' }] }]);
    expect(textOf(events)).toBe('hi');
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } });
  });

  it('throws a retryable error on 429', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 429, body: null, text: async () => 'rate limited' }) as unknown as Response) as unknown as typeof fetch;
    const adapter = new GeminiAdapter({ apiKey: 'k', fetchImpl });
    await expect(collect(adapter.chat([], [], { model: 'm' }))).rejects.toMatchObject({ retryable: true });
  });
});

// --- Task 5: end-to-end agent loop on Gemini ---
describe('Gemini end-to-end agent loop', () => {
  it('drives a tool call then a final answer through the real AgentLoop', async () => {
    // Two scripted Gemini turns: (1) call echo tool, (2) report done.
    const responses = [
      [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"echo","args":{"value":"abc"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\n\n',
      ],
      [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"done"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":6,"candidatesTokenCount":1}}\n\n',
      ],
    ];
    let call = 0;
    const fetchImpl = (async () => {
      const chunks = responses[Math.min(call, responses.length - 1)]!;
      call++;
      return { ok: true, status: 200, body: streamFromChunks(chunks), text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;

    const calls: string[] = [];
    const tools = new ToolRegistry();
    tools.register({
      name: 'echo',
      description: 'Echo a value',
      risk: 'read',
      schema: z.object({ value: z.string() }),
      run: async (input: { value: string }) => {
        calls.push(input.value);
        return `echoed: ${input.value}`;
      },
    });

    const provider = new GeminiAdapter({ apiKey: 'k', fetchImpl });
    const loop = new AgentLoop({ provider, model: 'gemini-1.5-pro', tools });
    const sink = new RecordingSink();
    await loop.run('please echo abc', sink);

    expect(calls).toEqual(['abc']);
    expect(sink.results[0]?.result.output).toBe('echoed: abc');
    expect(sink.fullText).toBe('done');
    // user, assistant(tool_use), tool(result), assistant(text)
    expect(loop.messages).toHaveLength(4);
    expect(loop.messages[2]?.role).toBe('tool');
  });
});
