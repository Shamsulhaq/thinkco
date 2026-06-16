import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/core/index.js';
import { RecordingSink } from '../src/agent/output.js';
import { FakeProvider } from '../src/providers/fake.js';
import { PermissionEngine, MemoryAuditLog } from '../src/permissions/index.js';
import { UsageTracker } from '../src/util/usage.js';

describe('UsageTracker', () => {
  const pricing = {
    byProviderModel: { openai: { 'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 } } },
    byModel: { 'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 } },
  };

  it('aggregates tokens and estimates cost from injected pricing', () => {
    const t = new UsageTracker();
    t.setPricing(pricing);
    t.add({ inputTokens: 1000, outputTokens: 1000 });
    t.add({ inputTokens: 500, outputTokens: 0 });
    const totals = t.totals();
    expect(totals.inputTokens).toBe(1500);
    expect(totals.turns).toBe(2);
    expect(t.estimateCost('gpt-4o', 'openai')).toBeGreaterThan(0);
    expect(t.format('gpt-4o', 'openai')).toMatch(/Usage:.*~\$/);
  });

  it('returns zero cost for unknown models or when pricing is not loaded', () => {
    const t = new UsageTracker();
    t.add({ inputTokens: 100, outputTokens: 100 });
    expect(t.estimateCost('mystery-model')).toBe(0); // no pricing loaded
    t.setPricing(pricing);
    expect(t.estimateCost('mystery-model')).toBe(0); // not in table
  });
});

describe('e2e: full agent stack with tools + permissions', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thinkco-e2e-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('model calls write tool (auto-allowed via rule), file is created, audited', async () => {
    const tools = new ToolRegistry();
    registerCoreTools(tools);

    const audit = new MemoryAuditLog();
    const engine = new PermissionEngine({
      rules: { allow: ['write'], deny: [], sandbox: false },
      prompt: async () => false, // would deny if prompted; allow-rule should auto-allow
      audit,
      origin: 'e2e',
    });

    // Scripted: turn 1 writes a file, turn 2 reports done.
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: 'w1', name: 'write', input: { path: 'hello.txt', content: 'hi from agent' } }] },
        { text: ['File created.'] },
      ],
    });

    const loop = new AgentLoop({ provider, model: 'fake-1', tools, cwd: dir, approve: engine.toHook() });
    const sink = new RecordingSink();
    await loop.run('create hello.txt', sink);

    // File really written.
    expect(existsSync(join(dir, 'hello.txt'))).toBe(true);
    expect(readFileSync(join(dir, 'hello.txt'), 'utf8')).toBe('hi from agent');
    // Final text produced.
    expect(sink.fullText).toBe('File created.');
    // Audit recorded the write as auto-allowed.
    expect(audit.entries.some((e) => e.tool === 'write' && e.decision === 'auto-allowed')).toBe(true);
  });

  it('destructive shell command is denied when not approved', async () => {
    const tools = new ToolRegistry();
    registerCoreTools(tools);
    const engine = new PermissionEngine({
      rules: { allow: ['shell:*'], deny: [], sandbox: false },
      prompt: async () => false, // user denies the destructive prompt
    });
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: 's1', name: 'shell', input: { command: 'rm -rf important-dir' } }] },
        { text: ['ok'] },
      ],
    });
    const loop = new AgentLoop({ provider, model: 'fake-1', tools, cwd: dir, approve: engine.toHook() });
    const sink = new RecordingSink();
    await loop.run('delete things', sink);
    expect(sink.results[0]?.result.isError).toBe(true);
    expect(sink.results[0]?.result.output).toMatch(/Permission denied/);
  });
});
