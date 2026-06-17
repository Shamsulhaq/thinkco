import { describe, it, expect } from 'vitest';
import { formatThinking } from '../src/ui/thinking.js';

describe('thinking display', () => {
  it('collapses whitespace into a single concise line', () => {
    expect(formatThinking('let   me\n\nthink  about   this')).toBe('let me think about this');
  });

  it('keeps the trailing portion when too long', () => {
    const long = 'x'.repeat(300);
    const out = formatThinking(long, 50);
    expect(out.startsWith('…')).toBe(true);
    expect(out.length).toBe(51); // ellipsis + 50
  });

  it('returns empty for blank input', () => {
    expect(formatThinking('   \n  ')).toBe('');
  });
});
