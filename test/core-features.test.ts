import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/context/store.js';
import { TaskStore } from '../src/agent/tasks.js';
import { taskTool } from '../src/tools/core/task.js';
import { memoryTool } from '../src/tools/core/memory.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SessionStore } from '../src/agent/session.js';
import { loadConfig } from '../src/config/index.js';
import { RecordingSink } from '../src/agent/output.js';
import type { Tool } from '../src/tools/types.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-core-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function runtime() {
  const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake' } });
  const tools = new ToolRegistry();
  const rt = new AgentRuntime({
    config,
    providerRegistry: new ProviderRegistry(),
    tools,
    sessionStore: new SessionStore(join(dir, 'sessions')),
    ui: { approve: async () => true, select: async () => null },
    cwd: dir,
    globalConfigDir: dir,
    auditPath: join(dir, 'audit.log'),
  });
  return { rt, tools };
}

describe('MemoryStore', () => {
  it('persists memory, notes, and checkpoints', () => {
    const m = new MemoryStore(dir);
    expect(m.hasContent()).toBe(false);
    m.setMemory('Project rules');
    m.appendNote('a note');
    m.setCheckpoint('snapshot');
    const s = m.snapshot();
    expect(s.memory).toBe('Project rules');
    expect(s.notes).toContain('a note');
    expect(s.checkpoint).toBe('snapshot');
    expect(m.hasContent()).toBe(true);
    expect(existsSync(join(dir, '.thinkco', 'memory', 'MEMORY.md'))).toBe(true);
  });
});

describe('TaskStore (tree)', () => {
  it('creates tree ids, statuses, descendants and summaries', () => {
    const t = new TaskStore(dir);
    expect(t.add('build feature').id).toBe('T1');
    expect(t.add('subtask', 'T1').id).toBe('T1.1');
    t.add('another', 'T1');
    expect(t.add('second top').id).toBe('T2');
    t.setStatus('T1.1', 'done');
    expect(t.open().map((x) => x.id)).toEqual(['T1', 'T1.2', 'T2']);
    expect(t.render()).toContain('T1.1');
    expect(t.openSummary()).toContain('T2');
    expect(t.remove('T1')).toBe(3); // T1, T1.1, T1.2
    expect(t.list().map((x) => x.id)).toEqual(['T2']);
    expect(new TaskStore(dir).list().map((x) => x.id)).toEqual(['T2']); // persisted
  });

  it('task tool adds, starts, completes, logs progress', async () => {
    const ctx = { cwd: dir };
    expect(await taskTool.run({ command: 'add', description: 'do X' }, ctx)).toContain('T1: do X');
    expect(await taskTool.run({ command: 'start', id: 'T1' }, ctx)).toContain('[~] T1');
    await taskTool.run({ command: 'progress', id: 'T1', note: 'made progress' }, ctx);
    expect(await taskTool.run({ command: 'progress', id: 'T1' }, ctx)).toContain('made progress');
    expect(await taskTool.run({ command: 'done', id: 'T1' }, ctx)).toContain('[x] T1');
  });

  it('respects dependencies and priority for next-actionable selection', () => {
    const t = new TaskStore(dir);
    const a = t.add('design', undefined, { priority: 'low' });
    const b = t.add('implement', undefined, { priority: 'high', dependsOn: [a.id] });
    expect(t.isBlocked(b.id)).toBe(true);
    // b is high priority but blocked by a → next is a
    expect(t.next()?.id).toBe(a.id);
    t.setStatus(a.id, 'done');
    expect(t.isBlocked(b.id)).toBe(false);
    expect(t.next()?.id).toBe(b.id);
    expect(t.render()).toMatch(/needs T1|BLOCKED|!high/);
  });
});

describe('primary agents + goal + compose', () => {
  it('/agent switches agent and aligns permission mode', async () => {
    const { rt } = runtime();
    expect(rt.agent).toBe('build');
    await rt.handleInput('/agent plan', new RecordingSink());
    expect(rt.agent).toBe('plan');
    expect(rt.getMode()).toBe('plan');
    await rt.handleInput('/agent build', new RecordingSink());
    expect(rt.agent).toBe('build');
    expect(rt.getMode()).toBe('default');
  });

  it('cycleAgent goes build → plan → compose → build', () => {
    const { rt } = runtime();
    expect(rt.cycleAgent()).toBe('plan');
    expect(rt.cycleAgent()).toBe('compose');
    expect(rt.cycleAgent()).toBe('build');
  });

  it('/goal sets and clears the stop condition', async () => {
    const { rt } = runtime();
    let sink = new RecordingSink();
    await rt.handleInput('/goal all tests pass', sink);
    expect(sink.notices.join(' ')).toMatch(/Goal set: all tests pass/);
    sink = new RecordingSink();
    await rt.handleInput('/goal', sink);
    expect(sink.notices.join(' ')).toMatch(/Goal: all tests pass/);
    sink = new RecordingSink();
    await rt.handleInput('/goal clear', sink);
    expect(sink.notices.join(' ')).toMatch(/Goal cleared/);
  });

  it('/compose switches to the compose agent', async () => {
    const { rt } = runtime();
    await rt.handleInput('/compose add a hello endpoint', new RecordingSink());
    expect(rt.agent).toBe('compose');
  });
});

describe('enhanced subagents', () => {
  it('runs a background subagent and tracks it via /agents (with result retrieval)', async () => {
    const { rt, tools } = runtime();
    const subagent = tools.list().find((t) => t.name === 'subagent') as Tool<{ task: string; background?: boolean }>;
    const out = await subagent.run({ task: 'investigate something', background: true }, { cwd: dir });
    const id = out.match(/\b(S\d+)\b/)?.[1] ?? 'S1';
    expect(out).toMatch(/Started background subagent/);
    // wait for the background subagent (fake provider) to finish
    await new Promise((r) => setTimeout(r, 50));
    let sink = new RecordingSink();
    await rt.handleInput('/agents', sink);
    expect(sink.notices.join(' ')).toMatch(/S1/);
    sink = new RecordingSink();
    await rt.handleInput(`/agents result ${id}`, sink);
    expect(sink.notices.join(' ').length).toBeGreaterThan(0);
  });
});

describe('memory tool', () => {
  it('remembers facts, takes notes, reads and searches memory', async () => {
    const ctx = { cwd: dir };
    const tool = memoryTool;
    await tool.run({ command: 'remember', text: 'Uses TypeScript ESM with Node 20' }, ctx);
    await tool.run({ command: 'note', text: 'investigating the parser bug' }, ctx);
    const read = await tool.run({ command: 'read' }, ctx);
    expect(read).toContain('TypeScript ESM');
    expect(read).toContain('parser bug');
    const found = await tool.run({ command: 'search', query: 'typescript node' }, ctx);
    expect(found.toLowerCase()).toContain('typescript');
    const none = await tool.run({ command: 'search', query: 'kubernetes helm' }, ctx);
    expect(none).toMatch(/No memory matches/);
  });
});

describe('compose orchestration', () => {
  it('runs the full lifecycle (plan→implement→review→test→verify) as phases', async () => {
    const { rt } = runtime();
    const sink = new RecordingSink();
    await rt.handleInput('/compose add a greeting helper', sink);
    const notices = sink.notices.join('\n');
    for (const phase of ['plan', 'implement', 'review', 'test', 'verify']) {
      expect(notices).toContain(`Compose phase: ${phase}`);
    }
    expect(notices).toMatch(/Compose lifecycle complete/);
    expect(rt.agent).toBe('compose');
  });
});
