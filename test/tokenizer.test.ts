import { describe, it, expect, afterEach } from 'vitest';
import {
  heuristicTokenizer,
  getTokenizer,
  setTokenizer,
  countTokens,
  initTokenizer,
} from '../src/context/tokenizer.js';
import { estimateTokens } from '../src/context/budget.js';

afterEach(() => setTokenizer(undefined)); // reset to heuristic

describe('tokenizer abstraction', () => {
  it('defaults to the ~4 chars/token heuristic', () => {
    expect(heuristicTokenizer.count('abcd')).toBe(1);
    expect(heuristicTokenizer.count('')).toBe(0);
    expect(estimateTokens('abcdefgh')).toBe(2); // ceil(8/4)
  });

  it('routes estimateTokens through the active tokenizer', () => {
    setTokenizer({ count: (t) => t.length }); // stub: 1 token per char
    expect(countTokens('hello')).toBe(5);
    expect(estimateTokens('hello')).toBe(5);
  });

  it('upgrades to a real BPE tokenizer via initTokenizer (optional dep present in dev)', async () => {
    const tok = await initTokenizer();
    expect(typeof tok.count).toBe('function');
    // Real BPE: "hello world" is 2 tokens; the heuristic would say ceil(11/4)=3.
    expect(getTokenizer().count('hello world')).toBe(2);
    expect(heuristicTokenizer.count('hello world')).toBe(3);
  });
});
