import { describe, it, expect } from 'vitest';
import { HINTS, QUEUE_HINT, randomHint } from '../src/ui/hints.js';

describe('hint engine', () => {
  it('always returns a hint from the pool', () => {
    for (let i = 0; i < 50; i++) expect(HINTS).toContain(randomHint());
  });

  it('avoids the excluded (current) hint so it visibly changes', () => {
    const current = HINTS[0]!;
    for (let i = 0; i < 50; i++) expect(randomHint(current)).not.toBe(current);
  });

  it('has a queue-aware busy hint mentioning queueing', () => {
    expect(QUEUE_HINT.toLowerCase()).toContain('queue');
  });
});
