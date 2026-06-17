import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { VscodeBridge } from '../src/frontends/vscode/bridge.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { FakeProvider } from '../src/providers/fake.js';
import type { ToolCall } from '../src/types/index.js';

describe('VscodeBridge', () => {
  it('streams a plain text turn to the onText handler', async () => {
    const bridge = new VscodeBridge({
      provider: new FakeProvider({ script: [{ text: ['Hello ', 'editor'] }] }),
      model: 'fake-1',
      tools: new ToolRegistry(),
    });
    let text = '';
    await bridge.send('hi', { onText: (d) => (text += d) });
    expect(text).toBe('Hello editor');
    expect(bridge.messages.length).toBe(2);
  });

  it('routes tool approval through the handler and reports denials', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'writer',
      description: 'writes',
      risk: 'execute',
      schema: z.object({}),
      run: async () => 'wrote',
    });
    const bridge = new VscodeBridge({
      provider: new FakeProvider({
        script: [{ toolCalls: [{ id: 'w', name: 'writer', input: {} }] }, { text: ['ok'] }],
      }),
      model: 'fake-1',
      tools,
    });

    const approvals: ToolCall[] = [];
    let text = '';
    await bridge.send('do it', {
      onText: (d) => (text += d),
      approve: async (call) => {
        approvals.push(call);
        return false; // deny
      },
    });

    expect(approvals.map((c) => c.name)).toEqual(['writer']);
    expect(text).toBe('ok');
    // The denied tool result is recorded in the conversation.
    const toolMsg = bridge.messages.find((m) => m.role === 'tool')!;
    expect(toolMsg.content.some((b) => b.type === 'tool_result' && b.isError)).toBe(true);
  });
});
