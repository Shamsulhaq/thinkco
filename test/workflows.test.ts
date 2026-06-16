import { describe, it, expect } from 'vitest';
import { HookRunner } from '../src/workflows/hooks.js';
import { topoSort, runPipeline, type PipelineStage } from '../src/workflows/pipeline.js';
import { runSubagent, spawnSubagentTool } from '../src/workflows/subagent.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { FakeProvider } from '../src/providers/fake.js';

describe('HookRunner', () => {
  it('runs commands for an event', () => {
    const calls: string[] = [];
    const runner = new HookRunner({ 'session-start': ['echo hi'] }, '.', (cmd) => {
      calls.push(cmd);
      return { code: 0, output: 'ok' };
    });
    const res = runner.run('session-start');
    expect(calls).toEqual(['echo hi']);
    expect(res.block).toBe(false);
  });

  it('pre-tool-use non-zero exit blocks', async () => {
    const runner = new HookRunner({ 'pre-tool-use': ['false'] }, '.', () => ({ code: 1, output: 'nope' }));
    const hook = runner.beforeToolHook();
    const verdict = await hook({ id: '1', name: 'shell', input: { command: 'rm -rf /' } });
    expect(verdict.block).toBe(true);
  });

  it('afterTool fires post-edit for edit/write tools', () => {
    const events: string[] = [];
    const runner = new HookRunner({ 'post-edit': ['fmt'] }, '.', (cmd) => {
      events.push(cmd);
      return { code: 0, output: '' };
    });
    const hook = runner.afterToolHook();
    return hook({ id: '1', name: 'write', input: { path: 'a.ts' } }, 'ok', false).then(() => {
      expect(events).toEqual(['fmt']);
    });
  });
});

describe('pipeline', () => {
  it('topologically sorts by dependencies', () => {
    const stages: PipelineStage[] = [
      { name: 'c', task: 't', dependsOn: ['b'] },
      { name: 'b', task: 't', dependsOn: ['a'] },
      { name: 'a', task: 't' },
    ];
    expect(topoSort(stages).map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('detects cycles', () => {
    const stages: PipelineStage[] = [
      { name: 'a', task: 't', dependsOn: ['b'] },
      { name: 'b', task: 't', dependsOn: ['a'] },
    ];
    expect(() => topoSort(stages)).toThrow(/Cycle/);
  });

  it('runs stages and passes dependency outputs as context', async () => {
    const stages: PipelineStage[] = [
      { name: 'research', task: 'find facts' },
      { name: 'write', task: 'write report', dependsOn: ['research'] },
    ];
    const seen: Record<string, Record<string, string>> = {};
    const result = await runPipeline(stages, async (task, context) => {
      seen[task] = context;
      return `output-of:${task}`;
    });
    expect(result.order).toEqual(['research', 'write']);
    expect(result.outputs.write).toBe('output-of:write report');
    expect(seen['write report']).toEqual({ research: 'output-of:find facts' });
  });
});

describe('subagent', () => {
  it('runs a nested loop and returns final text', async () => {
    const provider = new FakeProvider({ script: [{ text: ['subagent done'] }] });
    const res = await runSubagent('do subtask', { provider, model: 'fake-1', tools: new ToolRegistry() });
    expect(res.text).toBe('subagent done');
  });

  it('exposes a spawn_subagent tool', async () => {
    const provider = new FakeProvider({ script: [{ text: ['delegated result'] }] });
    const tool = spawnSubagentTool({ provider, model: 'fake-1', tools: new ToolRegistry() });
    expect(tool.name).toBe('spawn_subagent');
    const out = await tool.run({ task: 'go' }, { cwd: '.' });
    expect(out).toBe('delegated result');
  });
});
