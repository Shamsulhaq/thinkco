import { describe, it, expect } from 'vitest';
import { titleSequence, composeTitle, setTerminalTitle } from '../src/util/termtitle.js';

describe('terminal title', () => {
  it('wraps text in an OSC title sequence', () => {
    expect(titleSequence('hi')).toBe('\u001b]0;hi\u0007');
  });

  it('composes titles for ready/working/error states', () => {
    expect(composeTitle({ busy: false })).toBe('thinkco · ready');
    expect(composeTitle({ busy: true, elapsedSec: 9.6, toolCount: 2 })).toBe('thinkco · working 10s · 2 tools');
    expect(composeTitle({ busy: false, error: true })).toBe('thinkco · error');
  });

  it('only writes to a TTY', () => {
    const writes: string[] = [];
    setTerminalTitle('x', { isTTY: false, write: (s) => writes.push(s) });
    expect(writes).toEqual([]);
    setTerminalTitle('x', { isTTY: true, write: (s) => writes.push(s) });
    expect(writes).toEqual([titleSequence('x')]);
  });
});
