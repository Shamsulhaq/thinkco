import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRuntime } from '../src/agent/runtime.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SessionStore } from '../src/agent/session.js';
import { loadConfig } from '../src/config/index.js';
import { RecordingSink } from '../src/agent/output.js';
import { GitSnap } from '../src/workflows/checkpointGit.js';
import { sandboxGuard } from '../src/permissions/sandbox.js';
import { PermissionEngine } from '../src/permissions/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-rel-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function runtime(overrides: Record<string, unknown> = {}, registry = new ProviderRegistry()) {
  const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake', ...overrides } });
  const tools = new ToolRegistry();
  const rt = new AgentRuntime({
    config,
    providerRegistry: registry,
    tools,
    sessionStore: new SessionStore(join(dir, 'sessions')),
    ui: { approve: async () => true, select: async () => null },
    cwd: dir,
    globalConfigDir: dir,
    auditPath: join(dir, 'audit.log'),
  });
  return rt;
}

describe('provider/model failover', () => {
  it('switches to the fallback when the primary provider errors', async () => {
    const registry = new ProviderRegistry();
    registry.register('boom', () => ({
      // eslint-disable-next-line require-yield
      chat: async function* () {
        throw new Error('boom 500');
      },
    }) as never);
    const rt = runtime({ defaultProvider: 'boom', fallback: [{ provider: 'fake', model: 'fake-1' }] }, registry);
    const sink = new RecordingSink();
    await rt.handleInput('hello there', sink);
    expect(sink.notices.join(' ')).toMatch(/switching to fake/);
    expect(rt.state.provider).toBe('fake');
    expect(sink.errors.join(' ')).not.toMatch(/All providers/);
  });
});

describe('cost budget', () => {
  it('warns/stops when the per-session cap is exceeded', async () => {
    const rt = runtime({ defaultProvider: 'fake', defaultModel: 'gpt-4o', maxCostUSD: 0.000001 });
    rt.usage.setPricing({ byProviderModel: {}, byModel: { 'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 } } });
    const sink = new RecordingSink();
    await rt.handleInput('do something', sink);
    expect(sink.notices.join(' ')).toMatch(/budget/i);
  });
});

describe('git snapshots + /undo', () => {
  it('snapshots and restores via injected git exec', () => {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'true';
      if (args[0] === 'stash' && args[1] === 'create') return 'deadbeefcafe';
      return '';
    };
    const g = new GitSnap(dir, exec);
    expect(g.snapshot()).toBe('deadbeefcafe');
    expect(g.depth()).toBe(1);
    expect(g.undo()).toBe('deadbeefcafe');
    expect(calls.some((c) => c[0] === 'add' && c[1] === '-A')).toBe(true);
    expect(calls.some((c) => c[0] === 'checkout' && c[1] === 'deadbeefcafe')).toBe(true);
  });

  it('snapshot returns empty outside a git repo', () => {
    const g = new GitSnap(dir, () => {
      throw new Error('not a repo');
    });
    expect(g.snapshot()).toBe('');
  });

  it('/undo without autoCommit explains how to enable it', async () => {
    const rt = runtime();
    const sink = new RecordingSink();
    await rt.handleInput('/undo', sink);
    expect(sink.notices.join(' ')).toMatch(/autoCommit/);
  });
});

describe('task/agent model routing', () => {
  it('switches model (and provider) per agent from config.modelRouting', async () => {
    const rt = runtime({
      modelRouting: { plan: 'cheap-model', build: 'strong-model', compose: 'openai:gpt-4o-mini' },
      providers: { openai: { apiKey: 'test-key' } },
    });
    rt.setAgent('plan');
    expect(rt.state.model).toBe('cheap-model');
    rt.setAgent('build');
    expect(rt.state.model).toBe('strong-model');
    rt.setAgent('compose');
    expect(rt.state.provider).toBe('openai');
    expect(rt.state.model).toBe('gpt-4o-mini');
  });
});

describe('shell sandbox', () => {
  it('guard denies network/destructive/privilege, allows safe commands', () => {
    expect(sandboxGuard('curl http://evil.com').ok).toBe(false);
    expect(sandboxGuard('rm -rf /').ok).toBe(false);
    expect(sandboxGuard('sudo rm x').ok).toBe(false);
    expect(sandboxGuard('git push origin main').ok).toBe(false);
    expect(sandboxGuard('ls -la').ok).toBe(true);
    expect(sandboxGuard('npm test').ok).toBe(true);
  });

  it('engine blocks sandboxed shell commands even when the prompt would allow', async () => {
    const engine = new PermissionEngine({
      rules: { allow: ['shell:*'], deny: [], sandbox: true },
      prompt: async () => true,
    });
    const deny = await engine.decide({ id: 'c1', name: 'shell', input: { command: 'curl http://evil.com' } });
    expect(deny).toBe(false);
    const allow = await engine.decide({ id: 'c2', name: 'shell', input: { command: 'ls' } });
    expect(allow).toBe(true);
  });
});
