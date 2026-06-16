import { describe, it, expect } from 'vitest';
import { createWorktree } from '../src/workflows/worktree.js';
import { runTeam } from '../src/workflows/team.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { FakeProvider } from '../src/providers/fake.js';

describe('worktree isolation', () => {
  it('creates and cleans up a worktree via injected git', () => {
    const calls: string[][] = [];
    const gitExec = (args: string[]) => {
      calls.push(args);
      return '';
    };
    const wt = createWorktree({ repoRoot: '/repo', branch: 'thinkco/feat', dir: '/tmp/wts', gitExec });
    expect(wt.branch).toBe('thinkco/feat');
    expect(calls[0]).toEqual(['worktree', 'add', '-b', 'thinkco/feat', '/tmp/wts/thinkco-feat']);
    wt.cleanup();
    expect(calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(true);
  });
});

describe('agent team', () => {
  it('runs members concurrently and collects results in order', async () => {
    const provider = new FakeProvider({ echo: true });
    const tools = new ToolRegistry();
    const results = await runTeam(
      [
        { name: 'researcher', task: 'find facts' },
        { name: 'writer', task: 'write report' },
      ],
      { provider, model: 'fake-1', tools },
    );
    expect(results.map((r) => r.name)).toEqual(['researcher', 'writer']);
    expect(results[0]!.text).toContain('find facts');
    expect(results[1]!.text).toContain('write report');
  });

  it('captures per-member errors without failing the whole team', async () => {
    const boom = {
      name: 'boom',
      capabilities: { tools: true, streaming: true, systemPrompt: true },
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new Error('member crashed');
      },
    };
    // The subagent loop catches provider errors and reports via sink, so text is empty (no throw).
    const results = await runTeam([{ name: 'm1', task: 't' }], {
      provider: boom as never,
      model: 'm',
      tools: new ToolRegistry(),
    });
    expect(results[0]!.name).toBe('m1');
    expect(results[0]!.text).toBe('');
  });
});
