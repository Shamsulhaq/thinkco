import { describe, it, expect } from 'vitest';
import { FakeProvider } from '../src/providers/fake.js';
import { withRetry } from '../src/util/retry.js';
import { ProviderError } from '../src/util/errors.js';
import type { ProviderEvent, Message } from '../src/types/index.js';

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const userMsg = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

describe('FakeProvider', () => {
  it('echoes the last user message by default', async () => {
    const p = new FakeProvider();
    const events = await collect(p.chat([userMsg('hello')], [], { model: 'fake-1' }));
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    expect(text).toContain('hello');
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });

  it('emits scripted tool calls then stops with tool_use', async () => {
    const p = new FakeProvider({
      script: [{ text: ['thinking'], toolCalls: [{ id: 't1', name: 'read', input: { path: 'a' } }] }],
    });
    const events = await collect(p.chat([userMsg('go')], [], { model: 'fake-1' }));
    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toBeDefined();
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });
  });
});

describe('withRetry', () => {
  it('retries retryable ProviderError then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new ProviderError('rate limit', true);
        return 'ok';
      },
      { retries: 5, sleep: async () => {} },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ProviderError('bad request', false);
        },
        { retries: 5, sleep: async () => {} },
      ),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('gives up after max retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ProviderError('always', true);
        },
        { retries: 2, sleep: async () => {} },
      ),
    ).rejects.toThrow('always');
    expect(calls).toBe(3); // initial + 2 retries
  });
});
