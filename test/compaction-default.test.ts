import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { RecordingSink } from '../src/agent/output.js';
import { FakeProvider } from '../src/providers/fake.js';
import { providerSummarizer } from '../src/context/budget.js';
import type { Message, ProviderAdapter } from '../src/types/index.js';

const summarizerProvider = {
  name: 'sum',
  capabilities: { tools: false, streaming: true, systemPrompt: true },
  chat: async function* () {
    yield { type: 'text', text: 'LLM_SUMMARY' } as const;
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } as const;
    yield { type: 'stop', reason: 'end_turn' } as const;
  },
} as unknown as ProviderAdapter;

describe('LLM-backed compaction (default summarizer wiring)', () => {
  it('compacts older messages with the LLM summarizer, not heuristic truncation', async () => {
    const provider = new FakeProvider({ script: [{ text: ['done'] }] });
    const loop = new AgentLoop({
      provider,
      model: 'fake-1',
      tools: new ToolRegistry(),
      contextBudget: 50, // tiny budget to force compaction
      summarize: providerSummarizer(summarizerProvider, 'sum-model'),
    });

    // Seed a long history so the token budget is exceeded.
    const history: Message[] = [];
    for (let i = 0; i < 10; i++) {
      history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: `message ${i} `.repeat(20) }] });
    }
    loop.setMessages(history);

    const sink = new RecordingSink();
    await loop.run('continue', sink);

    const summary = loop.messages.find((m) => m.content.some((b) => b.type === 'text' && b.text.includes('LLM_SUMMARY')));
    expect(summary).toBeTruthy();
    // The lossy heuristic header must NOT appear.
    const joined = loop.messages.map((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')).join('\n');
    expect(joined).not.toContain('Summary of');
    expect(sink.notices.join(' ')).toMatch(/compacted/);
  });
});
