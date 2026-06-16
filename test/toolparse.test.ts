import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { extractTextToolCalls } from '../src/agent/toolparse.js';
import { AgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { RecordingSink } from '../src/agent/output.js';
import { FakeProvider } from '../src/providers/fake.js';
import type { Tool } from '../src/tools/types.js';

const valid = new Set(['list', 'read', 'edit']);

describe('extractTextToolCalls', () => {
  it('parses a fenced ```json tool call (the qwen/ollama pattern)', () => {
    const text = 'Let me explore:\n```json\n{"name": "list", "arguments": {"path": "."}}\n```\nDone.';
    const calls = extractTextToolCalls(text, valid);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'list', input: { path: '.' } });
  });

  it('parses multiple calls and ignores unknown tools and non-tool JSON', () => {
    const text = [
      '```json',
      '{"name":"read","arguments":{"path":"a.ts"}}',
      '```',
      '```json',
      '{"name":"unknown","arguments":{}}',
      '```',
      '```json',
      '{"foo":"bar"}',
      '```',
      '{"name":"edit","arguments":{"path":"a.ts","oldString":"x","newString":"y"}}',
    ].join('\n');
    const calls = extractTextToolCalls(text, valid);
    expect(calls.map((c) => c.name)).toEqual(['read', 'edit']);
  });

  it('parses <tool_call> wrapped JSON', () => {
    const text = '<tool_call>{"name":"list","arguments":{"path":"src"}}</tool_call>';
    expect(extractTextToolCalls(text, valid)[0]).toMatchObject({ name: 'list', input: { path: 'src' } });
  });

  it('deduplicates identical calls', () => {
    const text = '{"name":"list","arguments":{"path":"."}} and again {"name":"list","arguments":{"path":"."}}';
    expect(extractTextToolCalls(text, valid)).toHaveLength(1);
  });

  it('returns nothing for plain prose', () => {
    expect(extractTextToolCalls('Just a normal explanation with no tools.', valid)).toEqual([]);
  });

  it('ignores documentation examples with <placeholder> values', () => {
    const docs = [
      'Here are the tools available:',
      '```json',
      '{"name": "write", "arguments": {"path": "<file-path>", "content": "<content>"}}',
      '```',
      '```json',
      '{"name": "list", "arguments": {"path": "<directory-path>"}}',
      '```',
      '```json',
      '{"name": "read", "arguments": {"path": "<file-path>", "offset": 1}}',
      '```',
    ].join('\n');
    expect(extractTextToolCalls(docs, valid)).toEqual([]);
  });

  it('still extracts a real call with concrete values', () => {
    const text = '```json\n{"name":"read","arguments":{"path":"src/app.ts"}}\n```';
    expect(extractTextToolCalls(text, valid)).toHaveLength(1);
  });
});

describe('AgentLoop text tool-call fallback', () => {
  it('executes tool calls a model emitted as text', async () => {
    const ran: string[] = [];
    const tools = new ToolRegistry();
    tools.register({
      name: 'list',
      description: 'list',
      risk: 'read',
      schema: z.object({ path: z.string().optional() }),
      run: async (input: { path?: string }) => {
        ran.push(input.path ?? '.');
        return 'a.ts\nb.ts';
      },
    } as Tool<unknown>);

    // The model "thinks out loud" with a JSON tool call, then (next turn) answers.
    const provider = new FakeProvider({
      script: [
        { text: ['Let me look:\n```json\n{"name":"list","arguments":{"path":"src"}}\n```'] },
        { text: ['There are two files.'] },
      ],
    });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools });
    const sink = new RecordingSink();
    await loop.run('what files exist?', sink);

    expect(ran).toEqual(['src']); // the text tool call was executed
    expect(sink.fullText).toContain('There are two files.');
  });
});
