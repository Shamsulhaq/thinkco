import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { RecordingSink } from '../src/agent/output.js';
import { FakeProvider } from '../src/providers/fake.js';
import { CommandRegistry, builtinCommands } from '../src/agent/commands.js';
import { SessionStore, newSession } from '../src/agent/session.js';
import type { Tool } from '../src/tools/types.js';

function makeEchoTool(calls: string[]): Tool<{ value: string }> {
  return {
    name: 'echo',
    description: 'Echo a value',
    risk: 'read',
    schema: z.object({ value: z.string() }),
    run: async (input) => {
      calls.push(input.value);
      return `echoed: ${input.value}`;
    },
  };
}

describe('AgentLoop', () => {
  it('completes a plain text turn', async () => {
    const provider = new FakeProvider({ script: [{ text: ['Hello ', 'world'] }] });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools: new ToolRegistry() });
    const sink = new RecordingSink();
    await loop.run('hi', sink);
    expect(sink.fullText).toBe('Hello world');
    // user + assistant
    expect(loop.messages).toHaveLength(2);
    expect(loop.messages[1]?.role).toBe('assistant');
  });

  it('executes a tool call then continues to a final answer', async () => {
    const calls: string[] = [];
    const tools = new ToolRegistry();
    tools.register(makeEchoTool(calls));
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: 'c1', name: 'echo', input: { value: 'abc' } }] },
        { text: ['done'] },
      ],
    });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools });
    const sink = new RecordingSink();
    await loop.run('please echo', sink);

    expect(calls).toEqual(['abc']);
    expect(sink.results[0]?.result.output).toBe('echoed: abc');
    expect(sink.fullText).toBe('done');
    // user, assistant(tool_use), tool(result), assistant(text)
    expect(loop.messages).toHaveLength(4);
    expect(loop.messages[2]?.role).toBe('tool');
  });

  it('respects approval denial', async () => {
    const calls: string[] = [];
    const tools = new ToolRegistry();
    tools.register(makeEchoTool(calls));
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: 'c1', name: 'echo', input: { value: 'nope' } }] },
        { text: ['ok'] },
      ],
    });
    const loop = new AgentLoop({
      provider,
      model: 'fake-1',
      tools,
      approve: async () => false,
    });
    const sink = new RecordingSink();
    await loop.run('try', sink);
    expect(calls).toEqual([]); // tool never ran
    expect(sink.results[0]?.result.isError).toBe(true);
    expect(sink.results[0]?.result.output).toMatch(/Permission denied/);
  });

  it('reports invalid tool input as an error result', async () => {
    const tools = new ToolRegistry();
    tools.register(makeEchoTool([]));
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: 'c1', name: 'echo', input: { value: 123 } }] },
        { text: ['recovered'] },
      ],
    });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools });
    const sink = new RecordingSink();
    await loop.run('go', sink);
    expect(sink.results[0]?.result.isError).toBe(true);
    expect(sink.results[0]?.result.output).toMatch(/Invalid input/);
  });

  it('aborts when signal is already aborted', async () => {
    const provider = new FakeProvider({ script: [{ text: ['unused'] }] });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools: new ToolRegistry() });
    const sink = new RecordingSink();
    const ac = new AbortController();
    ac.abort();
    await loop.run('hi', sink, ac.signal);
    expect(sink.notices.join(' ')).toMatch(/Interrupted/);
  });
});

describe('ToolRegistry', () => {
  it('produces JSON Schema tool defs', () => {
    const tools = new ToolRegistry();
    tools.register(makeEchoTool([]));
    const defs = tools.toToolDefs();
    expect(defs[0]?.name).toBe('echo');
    expect(defs[0]?.inputSchema).toHaveProperty('type', 'object');
  });

  it('returns error for unknown tool', async () => {
    const tools = new ToolRegistry();
    const res = await tools.execute({ id: '1', name: 'ghost', input: {} }, { cwd: '.' });
    expect(res.isError).toBe(true);
  });
});

describe('CommandRegistry', () => {
  const reg = new CommandRegistry();
  builtinCommands().forEach((c) => reg.register(c));

  it('detects slash commands', () => {
    expect(CommandRegistry.isCommand('/help')).toBe(true);
    expect(CommandRegistry.isCommand('hello')).toBe(false);
  });

  it('switches provider', async () => {
    const state = { provider: 'fake', model: 'a' };
    const res = await reg.dispatch('/provider openai', state);
    expect(res.handled).toBe(true);
    expect(state.provider).toBe('openai');
  });

  it('flags exit', async () => {
    const state = { provider: 'fake', model: 'a', exit: false };
    await reg.dispatch('/exit', state);
    expect(state.exit).toBe(true);
  });

  it('reports unknown command', async () => {
    const res = await reg.dispatch('/bogus', { provider: 'fake', model: 'a' });
    expect(res.handled).toBe(false);
  });
});

describe('SessionStore', () => {
  it('saves, loads, and lists sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-sess-'));
    try {
      const store = new SessionStore(dir);
      const s = newSession('fake', 'fake-1');
      s.messages.push({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
      store.save(s);
      const loaded = store.load(s.id);
      expect(loaded?.messages[0]?.content[0]).toMatchObject({ type: 'text', text: 'hi' });
      expect(store.list().length).toBe(1);
      expect(store.latest()?.id).toBe(s.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prunes to the most recent N sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-prune-'));
    try {
      const store = new SessionStore(dir, 3);
      for (let i = 0; i < 6; i++) {
        const s = newSession('fake', 'fake-1', `sess_${i}`);
        store.save(s);
      }
      expect(store.list().length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


describe('AgentLoop resilience', () => {
  it('does not throw when the provider errors mid-stream', async () => {
    const provider = {
      name: 'boom',
      capabilities: { tools: true, streaming: true, systemPrompt: true },
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new Error('connection reset');
      },
    };
    const loop = new AgentLoop({ provider: provider as never, model: 'm', tools: new ToolRegistry() });
    const sink = new RecordingSink();
    await expect(loop.run('hi', sink)).resolves.toBeUndefined();
    expect(sink.errors.join(' ')).toMatch(/Provider error: connection reset/);
  });
});


describe('AgentLoop turn completion feedback', () => {
  it('emits a done notice when tools ran but the model returns no final text', async () => {
    const { z } = await import('zod');
    const tools = new ToolRegistry();
    tools.register({
      name: 'touch',
      description: 'touch',
      risk: 'edit',
      schema: z.object({}),
      run: async () => 'ok',
    } as never);
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: 't1', name: 'touch', input: {} }] },
        {}, // final turn: no text, no tool calls
      ],
    });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools });
    const sink = new RecordingSink();
    await loop.run('do it', sink);
    expect(sink.notices.join(' ')).toMatch(/done/i);
  });
});
