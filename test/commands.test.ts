import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { substituteTemplate, parseCommandFile, loadCustomCommands } from '../src/commands/custom.js';

describe('substituteTemplate', () => {
  it('substitutes $ARGUMENTS', () => {
    expect(substituteTemplate('Review: $ARGUMENTS', 'the auth module')).toBe('Review: the auth module');
  });

  it('substitutes {{args}}', () => {
    expect(substituteTemplate('Do {{args}} now', 'X')).toBe('Do X now');
  });

  it('substitutes positional args', () => {
    expect(substituteTemplate('$1 and $2', 'foo bar')).toBe('foo and bar');
  });

  it('injects command output with !`cmd`', () => {
    const out = substituteTemplate('Branch: !`git branch`', '', {
      exec: (cmd) => (cmd === 'git branch' ? 'main' : '?'),
    });
    expect(out).toBe('Branch: main');
  });

  it('preserves injected command output without placeholders', () => {
    const out = substituteTemplate('Status:\n!`status`', 'ignored', { exec: () => 'clean tree' });
    expect(out).toBe('Status:\nclean tree');
  });
});

describe('custom command loading', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thinkco-cmd-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parses a command file with frontmatter', () => {
    const p = join(dir, 'review.md');
    writeFileSync(p, '---\nname: review\ndescription: Review code\n---\nReview this: $ARGUMENTS');
    const def = parseCommandFile(p);
    expect(def.name).toBe('review');
    expect(def.description).toBe('Review code');
    expect(def.template).toBe('Review this: $ARGUMENTS');
  });

  it('loads commands that emit prompts', async () => {
    writeFileSync(join(dir, 'summarize.md'), 'Summarize $ARGUMENTS');
    const cmds = loadCustomCommands(dir);
    const summarize = cmds.find((c) => c.name === 'summarize');
    expect(summarize).toBeDefined();
    const result = await summarize!.run({ args: 'the readme', state: { provider: 'fake', model: 'm' } });
    expect(result.prompt).toBe('Summarize the readme');
    expect(result.handled).toBe(true);
  });

  it('returns empty for a missing directory', () => {
    expect(loadCustomCommands(join(dir, 'nope'))).toEqual([]);
  });
});


describe('substituteTemplate — Agent Skills parity', () => {
  it('substitutes $ARGUMENTS[N] (0-based)', () => {
    expect(substituteTemplate('Migrate $ARGUMENTS[0] from $ARGUMENTS[1]', 'Button React')).toBe(
      'Migrate Button from React',
    );
  });

  it('substitutes named args from frontmatter argNames', () => {
    const out = substituteTemplate('Fix $issue on $branch', '123 main', { argNames: ['issue', 'branch'] });
    expect(out).toBe('Fix 123 on main');
  });

  it('runs fenced ```! blocks', () => {
    const out = substituteTemplate('Env:\n```!\nnode --version\n```', '', {
      exec: (cmd) => (cmd.includes('node') ? 'v20.0.0' : '?'),
    });
    expect(out).toContain('v20.0.0');
  });
});
