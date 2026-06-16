import { describe, it, expect } from 'vitest';
import { classifyAction, isSecretPath, findDestructive, describeCall } from '../src/permissions/classify.js';
import { PermissionEngine } from '../src/permissions/engine.js';
import { MemoryAuditLog } from '../src/permissions/audit.js';
import type { ToolCall } from '../src/types/index.js';
import type { Tool } from '../src/tools/types.js';
import { z } from 'zod';

const readTool = { name: 'read', description: '', risk: 'read', schema: z.object({}), run: async () => '' } as Tool<unknown>;
const shellTool = { name: 'shell', description: '', risk: 'execute', schema: z.object({}), run: async () => '' } as Tool<unknown>;

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: '1', name, input });

describe('classifier', () => {
  it('detects destructive rm -rf', () => {
    expect(findDestructive('rm -rf /tmp/x')).toBeTruthy();
    expect(findDestructive('ls -la')).toBeUndefined();
  });

  it('detects git force push', () => {
    expect(findDestructive('git push origin main --force')).toBeTruthy();
  });

  it('detects secret paths', () => {
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('config/.env.local')).toBe(true);
    expect(isSecretPath('src/app.ts')).toBe(false);
    expect(isSecretPath('id_rsa')).toBe(true);
  });

  it('classifies a destructive shell call', () => {
    const a = classifyAction(call('shell', { command: 'rm -rf build' }), shellTool);
    expect(a.destructive).toBe(true);
    expect(a.risk).toBe('execute');
  });

  it('classifies a secret-file read', () => {
    const a = classifyAction(call('read', { path: '.env' }), readTool);
    expect(a.secret).toBe(true);
  });
});

describe('describeCall (human-readable)', () => {
  it('summarizes write without dumping content', () => {
    const big = 'x'.repeat(5000);
    const desc = describeCall(call('write', { path: 'index.html', content: big }));
    expect(desc).toBe('Write file "index.html" (5000 bytes)');
    expect(desc).not.toContain('xxxx');
  });

  it('describes edit, read, shell, git, web_fetch', () => {
    expect(describeCall(call('edit', { path: 'a.ts' }))).toBe('Edit file "a.ts"');
    expect(describeCall(call('read', { path: 'b.ts' }))).toBe('Read file "b.ts"');
    expect(describeCall(call('shell', { command: 'npm test' }))).toBe('Run command: npm test');
    expect(describeCall(call('git', { subcommand: 'status' }))).toContain('git status');
    expect(describeCall(call('web_fetch', { url: 'https://x.com' }))).toContain('https://x.com');
  });

  it('labels MCP and skill tools', () => {
    expect(describeCall(call('mcp__files__read', {}))).toContain('MCP tool');
    expect(describeCall(call('skill__demo__go_sh', {}))).toContain('skill script');
  });
});

describe('PermissionEngine', () => {
  const baseRules = { allow: [], deny: [], sandbox: false };

  it('auto-allows read-only non-secret actions', async () => {
    const audit = new MemoryAuditLog();
    const eng = new PermissionEngine({ rules: baseRules, prompt: async () => false, audit });
    const ok = await eng.decide(call('read', { path: 'a.ts' }), readTool);
    expect(ok).toBe(true);
    expect(audit.entries[0]?.decision).toBe('auto-allowed');
  });

  it('prompts for secret-file reads', async () => {
    let prompted = false;
    const eng = new PermissionEngine({
      rules: baseRules,
      prompt: async () => {
        prompted = true;
        return true;
      },
    });
    const ok = await eng.decide(call('read', { path: '.env' }), readTool);
    expect(prompted).toBe(true);
    expect(ok).toBe(true);
  });

  it('denies when a deny rule matches', async () => {
    const audit = new MemoryAuditLog();
    const eng = new PermissionEngine({ rules: { ...baseRules, deny: ['shell'] }, prompt: async () => true, audit });
    const ok = await eng.decide(call('shell', { command: 'echo hi' }), shellTool);
    expect(ok).toBe(false);
    expect(audit.entries[0]?.decision).toBe('auto-denied');
  });

  it('auto-allows when an allow rule matches a safe command', async () => {
    const eng = new PermissionEngine({
      rules: { ...baseRules, allow: ['shell:npm test*'] },
      prompt: async () => false,
    });
    const ok = await eng.decide(call('shell', { command: 'npm test --watch' }), shellTool);
    expect(ok).toBe(true);
  });

  it('still prompts for destructive commands even with allow rule', async () => {
    let prompted = false;
    const eng = new PermissionEngine({
      rules: { ...baseRules, allow: ['shell:*'] },
      prompt: async () => {
        prompted = true;
        return false;
      },
    });
    const ok = await eng.decide(call('shell', { command: 'rm -rf /' }), shellTool);
    expect(prompted).toBe(true);
    expect(ok).toBe(false);
  });

  it('strictRemote suppresses auto-allow for non-read actions', async () => {
    let prompted = false;
    const eng = new PermissionEngine({
      rules: { ...baseRules, allow: ['shell:*'] },
      prompt: async () => {
        prompted = true;
        return true;
      },
      strictRemote: true,
    });
    await eng.decide(call('shell', { command: 'ls' }), shellTool);
    expect(prompted).toBe(true);
  });

  it('toHook returns a working approval hook', async () => {
    const eng = new PermissionEngine({ rules: baseRules, prompt: async () => true });
    const hook = eng.toHook();
    expect(await hook(call('read', { path: 'x' }), readTool)).toEqual({ allow: true });
  });

  it('toHook gives a plan-mode reason on denial', async () => {
    const eng = new PermissionEngine({ rules: baseRules, prompt: async () => true, mode: 'plan' });
    const hook = eng.toHook();
    const writeTool2 = { name: 'write', description: '', risk: 'edit', schema: z.object({}), run: async () => '' } as Tool<unknown>;
    const verdict = await hook(call('write', { path: 'a.ts', content: 'x' }), writeTool2);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toMatch(/plan mode/);
  });
});

describe('permission modes', () => {
  const baseRules = { allow: [], deny: [], sandbox: false };
  const writeTool = { name: 'write', description: '', risk: 'edit', schema: z.object({}), run: async () => '' } as Tool<unknown>;

  it('plan mode denies mutations, allows reads', async () => {
    const eng = new PermissionEngine({ rules: baseRules, prompt: async () => true, mode: 'plan' });
    expect(await eng.decide(call('read', { path: 'a.ts' }), readTool)).toBe(true);
    expect(await eng.decide(call('write', { path: 'a.ts', content: 'x' }), writeTool)).toBe(false);
  });

  it('acceptEdits auto-approves edits but prompts for destructive', async () => {
    let prompted = 0;
    const eng = new PermissionEngine({
      rules: baseRules,
      prompt: async () => {
        prompted++;
        return false;
      },
      mode: 'acceptEdits',
    });
    expect(await eng.decide(call('write', { path: 'a.ts', content: 'x' }), writeTool)).toBe(true);
    await eng.decide(call('shell', { command: 'rm -rf build' }), shellTool);
    expect(prompted).toBe(1); // destructive shell still prompted
  });

  it('bypass runs everything except circuit breakers', async () => {
    let prompted = 0;
    const eng = new PermissionEngine({
      rules: baseRules,
      prompt: async () => {
        prompted++;
        return false;
      },
      mode: 'bypass',
    });
    expect(await eng.decide(call('shell', { command: 'echo hi' }), shellTool)).toBe(true);
    await eng.decide(call('shell', { command: 'rm -rf /' }), shellTool);
    expect(prompted).toBe(1); // circuit breaker prompted even in bypass
  });

  it('dontAsk denies non-allowlisted without prompting', async () => {
    let prompted = 0;
    const eng = new PermissionEngine({
      rules: { allow: ['shell:npm *'], deny: [], sandbox: false },
      prompt: async () => {
        prompted++;
        return true;
      },
      mode: 'dontAsk',
    });
    expect(await eng.decide(call('shell', { command: 'npm test' }), shellTool)).toBe(true);
    expect(await eng.decide(call('shell', { command: 'curl evil' }), shellTool)).toBe(false);
    expect(prompted).toBe(0);
  });

  it('cycleMode rotates default → acceptEdits → plan → default', () => {
    const eng = new PermissionEngine({ rules: baseRules, prompt: async () => false });
    expect(eng.getMode()).toBe('default');
    expect(eng.cycleMode()).toBe('acceptEdits');
    expect(eng.cycleMode()).toBe('plan');
    expect(eng.cycleMode()).toBe('default');
  });

  it('protected-path writes always prompt even in acceptEdits', async () => {
    let prompted = 0;
    const eng = new PermissionEngine({
      rules: baseRules,
      prompt: async () => {
        prompted++;
        return false;
      },
      mode: 'acceptEdits',
    });
    await eng.decide(call('write', { path: '.git/config', content: 'x' }), writeTool);
    expect(prompted).toBe(1);
  });

  it('auto mode uses the classifier and falls back after repeated blocks', async () => {
    let prompted = 0;
    const eng = new PermissionEngine({
      rules: baseRules,
      prompt: async () => {
        prompted++;
        return true;
      },
      mode: 'auto',
      classifier: async (c) => ({ allow: !String(c.input.command).includes('rm') }),
    });
    expect(await eng.decide(call('shell', { command: 'ls' }), shellTool)).toBe(true);
    // 3 consecutive blocks then fallback to prompt
    await eng.decide(call('shell', { command: 'rm a' }), shellTool);
    await eng.decide(call('shell', { command: 'rm b' }), shellTool);
    await eng.decide(call('shell', { command: 'rm c' }), shellTool);
    await eng.decide(call('shell', { command: 'rm d' }), shellTool);
    expect(prompted).toBeGreaterThan(0); // fell back to manual prompt
  });
});


describe('provider-backed classifier (auto mode)', () => {
  it('allows when the model says ALLOW and denies on DENY', async () => {
    const { makeProviderClassifier } = await import('../src/permissions/classifier.js');
    const { FakeProvider } = await import('../src/providers/fake.js');
    const assess = { risk: 'edit' as const, destructive: false, secret: false, protected: false, reasons: [] };

    const allowProvider = new FakeProvider({ script: [{ text: ['ALLOW'] }], echo: false });
    const allow = makeProviderClassifier(allowProvider, 'fake-1');
    expect(await allow({ id: '1', name: 'write', input: { path: 'a.ts' } }, assess)).toEqual({ allow: true });

    const denyProvider = new FakeProvider({ script: [{ text: ['DENY: irreversible'] }], echo: false });
    const deny = makeProviderClassifier(denyProvider, 'fake-1');
    const verdict = await deny({ id: '2', name: 'shell', input: { command: 'rm -rf x' } }, assess);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toMatch(/irreversible/);
  });
});
