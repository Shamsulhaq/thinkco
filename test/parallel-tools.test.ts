import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { RecordingSink } from '../src/agent/output.js';
import { FakeProvider } from '../src/providers/fake.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('parallel tool execution', () => {
  it('runs independent read tools concurrently and preserves result order', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'slow_read',
      description: 'A slow read',
      risk: 'read',
      schema: z.object({ id: z.string() }),
      run: async (input: { id: string }) => {
        await sleep(60);
        return `read:${input.id}`;
      },
    });

    const provider = new FakeProvider({
      script: [
        {
          toolCalls: [
            { id: 'a', name: 'slow_read', input: { id: '1' } },
            { id: 'b', name: 'slow_read', input: { id: '2' } },
            { id: 'c', name: 'slow_read', input: { id: '3' } },
          ],
        },
        { text: ['done'] },
      ],
    });

    const loop = new AgentLoop({ provider, model: 'fake-1', tools });
    const sink = new RecordingSink();
    const start = Date.now();
    await loop.run('read three', sink);
    const elapsed = Date.now() - start;

    // Three 60ms reads run concurrently → well under the ~180ms sequential cost.
    expect(elapsed).toBeLessThan(150);

    // tool message holds results in original call order.
    const toolMsg = loop.messages.find((m) => m.role === 'tool')!;
    const outputs = toolMsg.content.map((b) => (b.type === 'tool_result' ? b.content : ''));
    expect(outputs).toEqual(['read:1', 'read:2', 'read:3']);
  });

  it('preserves order and results when one call is denied', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'r',
      description: 'read',
      risk: 'read',
      schema: z.object({ id: z.string() }),
      run: async (input: { id: string }) => `ok:${input.id}`,
    });

    const provider = new FakeProvider({
      script: [
        {
          toolCalls: [
            { id: 'a', name: 'r', input: { id: '1' } },
            { id: 'b', name: 'r', input: { id: '2' } },
            { id: 'c', name: 'r', input: { id: '3' } },
          ],
        },
        { text: ['done'] },
      ],
    });

    // Deny the middle call only.
    const loop = new AgentLoop({
      provider,
      model: 'fake-1',
      tools,
      approve: async (call) => call.id !== 'b',
    });
    const sink = new RecordingSink();
    await loop.run('go', sink);

    const toolMsg = loop.messages.find((m) => m.role === 'tool')!;
    const blocks = toolMsg.content.filter((b) => b.type === 'tool_result') as Array<{ toolUseId: string; content: string; isError?: boolean }>;
    expect(blocks.map((b) => b.toolUseId)).toEqual(['a', 'b', 'c']);
    expect(blocks[0]!.content).toBe('ok:1');
    expect(blocks[1]!.isError).toBe(true); // denied
    expect(blocks[2]!.content).toBe('ok:3');
  });
});
