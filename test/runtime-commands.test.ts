import { describe, it, expect } from 'vitest';
import { buildInfoCommands } from '../src/agent/commands/info.js';
import { buildBudgetCommands } from '../src/agent/commands/budget.js';
import { buildAgentCommands } from '../src/agent/commands/agents.js';
import type { CommandHost, AgentName, SubagentEntry } from '../src/agent/commands/host.js';
import type { SlashCommand } from '../src/agent/commands.js';

/** A minimal in-memory host so command modules can be tested without the full runtime. */
function fakeHost(over: Partial<CommandHost> = {}): { host: CommandHost; rec: { agent: AgentName; goal?: string; spec?: string; mode: string } } {
  const rec: { agent: AgentName; goal?: string; spec?: string; mode: string } = { agent: 'build', mode: 'default' };
  const subagents: SubagentEntry[] = [];
  const host = {
    state: { provider: 'fake', model: 'fake-1' },
    config: { maxCostUSD: 0, autoCommit: false, fallback: [], permissions: { allow: [] } },
    usage: { estimateCost: () => 0, format: () => 'Usage: 0', setPricing: () => {} },
    engine: {},
    skills: { list: () => [] },
    providerRegistry: {},
    availableModels: [],
    ui: { approve: async () => false, select: async () => null },
    setMode: (m: string) => {
      rec.mode = m;
    },
    getMode: () => rec.mode,
    knownProviders: () => ['fake'],
    isProviderConfigured: () => true,
    configuredProviders: () => ['fake'],
    switchProvider: async () => 'switched',
    finishLogin: async () => 'logged in',
    setSkipPersistOnce: () => {},
    getAgent: () => rec.agent,
    setAgent: (n: AgentName) => {
      rec.agent = n;
    },
    getGoal: () => rec.goal,
    setGoal: (g: string | undefined) => {
      rec.goal = g;
    },
    setComposeSpec: (s: string) => {
      rec.spec = s;
    },
    subagents,
    gitSnap: () => ({ undo: () => undefined }),
    ...over,
  } as unknown as CommandHost;
  return { host, rec };
}

function find(cmds: SlashCommand[], name: string): SlashCommand {
  const c = cmds.find((x) => x.name === name);
  if (!c) throw new Error(`command ${name} not found`);
  return c;
}

describe('extracted command modules (isolated)', () => {
  it('/mode sets the permission mode through the host', async () => {
    const { host, rec } = fakeHost();
    const mode = find(buildInfoCommands(host), 'mode');
    const res = await mode.run({ args: 'plan', state: host.state });
    expect(res.message).toContain('plan');
    expect(rec.mode).toBe('plan');
  });

  it('/trust adds basic allow rules to config', async () => {
    const { host } = fakeHost();
    const trust = find(buildInfoCommands(host), 'trust');
    await trust.run({ args: '', state: host.state });
    expect(host.config.permissions.allow).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'shell']),
    );
  });

  it('/budget sets the cost cap', async () => {
    const { host } = fakeHost();
    const budget = find(buildBudgetCommands(host), 'budget');
    const res = await budget.run({ args: '5', state: host.state });
    expect(host.config.maxCostUSD).toBe(5);
    expect(res.message).toContain('Budget 5');
  });

  it('/agent switches the active agent', async () => {
    const { host, rec } = fakeHost();
    const agent = find(buildAgentCommands(host), 'agent');
    const res = await agent.run({ args: 'plan', state: host.state });
    expect(rec.agent).toBe('plan');
    expect(res.message).toContain('plan');
  });

  it('/goal sets and clears a stop condition', async () => {
    const { host, rec } = fakeHost();
    const goal = find(buildAgentCommands(host), 'goal');
    await goal.run({ args: 'tests pass', state: host.state });
    expect(rec.goal).toBe('tests pass');
    await goal.run({ args: 'clear', state: host.state });
    expect(rec.goal).toBeUndefined();
  });

  it('/compose stores the spec and switches to compose', async () => {
    const { host, rec } = fakeHost();
    const compose = find(buildAgentCommands(host), 'compose');
    const res = await compose.run({ args: 'build a todo app', state: host.state });
    expect(rec.agent).toBe('compose');
    expect(rec.spec).toBe('build a todo app');
    expect(res.message).toContain('Composing');
  });
});
