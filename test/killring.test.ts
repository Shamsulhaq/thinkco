import { describe, it, expect } from 'vitest';
import { KillRing, killToLineEnd, killWordBackward, resolveEditor } from '../src/ui/killring.js';

describe('kill-ring', () => {
  it('kills, yanks, and rotates with yank-pop', () => {
    const r = new KillRing();
    r.kill('alpha');
    r.kill('beta');
    expect(r.yank()).toBe('beta'); // most recent
    expect(r.yankPop()).toBe('alpha'); // previous
    expect(r.yankPop()).toBe('beta'); // wraps
  });

  it('ignores empty kills and returns empty yank on empty ring', () => {
    const r = new KillRing();
    r.kill('');
    expect(r.entries).toEqual([]);
    expect(r.yank()).toBe('');
  });

  it('kills to end of line', () => {
    expect(killToLineEnd('hello world', 5)).toEqual({ value: 'hello', killed: ' world' });
  });

  it('kills the previous word', () => {
    const res = killWordBackward('foo bar baz', 11);
    expect(res.value).toBe('foo bar ');
    expect(res.killed).toBe('baz');
    expect(res.cursor).toBe(8);
  });

  it('resolves the editor from env', () => {
    expect(resolveEditor({ EDITOR: 'nano' })).toBe('nano');
    expect(resolveEditor({ VISUAL: 'code -w', EDITOR: 'vi' })).toBe('code -w');
    expect(resolveEditor({})).toBe('vi');
  });
});
