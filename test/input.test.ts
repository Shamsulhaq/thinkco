import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandHistory, detectAtMention, pathCompletions, shouldSubmitOnEnter } from '../src/ui/input.js';

describe('CommandHistory', () => {
  it('records, dedupes, and navigates', () => {
    const h = new CommandHistory();
    h.add('first');
    h.add('second');
    h.add('second'); // dup ignored
    h.add('');       // blank ignored
    expect(h.entries).toEqual(['first', 'second']);

    expect(h.prev('draft')).toBe('second');
    expect(h.prev()).toBe('first');
    expect(h.prev()).toBe('first'); // clamps at oldest
    expect(h.next()).toBe('second');
    expect(h.next()).toBe('draft'); // restores draft past newest
  });

  it('reverse-searches by substring', () => {
    const h = new CommandHistory();
    h.add('git status');
    h.add('npm test');
    h.add('git push');
    expect(h.search('git')).toBe('git push');
    expect(h.search('npm')).toBe('npm test');
    expect(h.search('zzz')).toBeUndefined();
  });
});

describe('@-mention completion', () => {
  it('detects a trailing @token', () => {
    expect(detectAtMention('look at @src/ind')?.prefix).toBe('src/ind');
    expect(detectAtMention('no mention here')).toBeUndefined();
  });

  it('completes paths from the filesystem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-input-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'README.md'), '#');
    writeFileSync(join(dir, 'src', 'index.ts'), '');
    expect(pathCompletions('READ', dir)).toEqual(['README.md']);
    expect(pathCompletions('src/', dir)).toEqual(['src/index.ts']);
    expect(pathCompletions('s', dir)).toEqual(['src/']);
  });

  it('decides submit vs newline', () => {
    expect(shouldSubmitOnEnter('hello', false)).toBe(true);
    expect(shouldSubmitOnEnter('hello', true)).toBe(false); // shift+enter = newline
    expect(shouldSubmitOnEnter('line\\', false)).toBe(false); // trailing backslash = continue
  });
});
