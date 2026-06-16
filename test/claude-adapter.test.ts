import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadClaudePlugin, agentFileToSkill } from '../src/plugins/claudeAdapter.js';
import { mcpServersFromClaudePlugin, collectClaudeMcpServers } from '../src/plugins/claudeMcp.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SessionStore } from '../src/agent/session.js';
import { loadConfig } from '../src/config/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-claude-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeAgent(root: string, rel: string, name: string, desc: string, body = 'Persona body.') {
  const file = join(root, '.claude', 'agents', rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `---\nname: ${name}\ndescription: ${desc}\ntools: read, grep\n---\n${body}`);
}

describe('Claude Code adapter', () => {
  it('parses an agent file into a skill', () => {
    const file = join(dir, 'coder.md');
    writeFileSync(file, '---\nname: coder\ndescription: Writes code\ntools: read, edit\n---\nBe a great coder.');
    const skill = agentFileToSkill(file)!;
    expect(skill.name).toBe('coder');
    expect(skill.description).toBe('Writes code');
    expect(skill.allowedTools).toEqual(['read', 'edit']);
    expect(skill.body).toContain('great coder');
  });

  it('loads agents (recursively) as skills and commands as commands', () => {
    writeAgent(dir, join('core', 'coder.md'), 'coder', 'Implementation specialist');
    writeAgent(dir, 'reviewer.md', 'reviewer', 'Review specialist');
    const cmdDir = join(dir, '.claude', 'commands');
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, 'sparc.md'), '---\nname: sparc\ndescription: SPARC\n---\nDo SPARC on $ARGUMENTS');

    const { skills, commands } = loadClaudePlugin(dir);
    expect(skills.map((s) => s.name).sort()).toEqual(['coder', 'reviewer']);
    expect(commands.map((c) => c.name)).toContain('sparc');
    // derived triggers include the name
    expect(skills.find((s) => s.name === 'coder')!.triggers).toContain('coder');
  });

  it('returns empty for a directory without a .claude folder', () => {
    const { skills, commands } = loadClaudePlugin(dir);
    expect(skills).toHaveLength(0);
    expect(commands).toHaveLength(0);
  });
});

describe('bundled ruflo-core default plugin', () => {
  it('auto-loads the curated coding agents as skills', () => {
    const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake' } });
    const rt = new AgentRuntime({
      config,
      providerRegistry: new ProviderRegistry(),
      tools: new ToolRegistry(),
      sessionStore: new SessionStore(join(dir, 'sessions')),
      ui: { approve: async () => true, select: async () => null },
      cwd: dir,
      globalConfigDir: dir,
    });
    const names = rt.skillRegistry.list().map((s) => s.name);
    for (const expected of ['coder', 'reviewer', 'tester', 'planner', 'researcher', 'architect', 'code-analyzer']) {
      expect(names).toContain(expected);
    }
  });

  it('loads an opt-in Claude Code plugin from config.claudePlugins', () => {
    const extra = join(dir, 'extra-plugin');
    writeAgent(extra, 'special.md', 'special-agent', 'A special opt-in agent');
    const config = loadConfig({
      globalDir: dir,
      projectDir: dir,
      overrides: { defaultProvider: 'fake', claudePlugins: [extra] },
    });
    const rt = new AgentRuntime({
      config,
      providerRegistry: new ProviderRegistry(),
      tools: new ToolRegistry(),
      sessionStore: new SessionStore(join(dir, 'sessions')),
      ui: { approve: async () => true, select: async () => null },
      cwd: dir,
      globalConfigDir: dir,
    });
    expect(rt.skillRegistry.list().map((s) => s.name)).toContain('special-agent');
  });
});

describe('Claude Code plugin MCP discovery', () => {
  function writeManifest(root: string, mcpServers: Record<string, unknown>) {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'cf', mcpServers }));
  }

  it('extracts required MCP servers and skips optional ones', () => {
    const p = join(dir, 'ruflo');
    writeManifest(p, {
      'claude-flow': { command: 'npx', args: ['claude-flow@alpha', 'mcp', 'start'], optional: false },
      'ruv-swarm': { command: 'npx', args: ['ruv-swarm'], optional: true },
    });
    const servers = mcpServersFromClaudePlugin(p);
    expect(Object.keys(servers)).toEqual(['claude-flow']);
    expect(servers['claude-flow']).toEqual({ command: 'npx', args: ['claude-flow@alpha', 'mcp', 'start'], env: undefined });
  });

  it('collects opt-in Claude plugin MCP servers by path', () => {
    const p = join(dir, 'mine');
    writeManifest(p, { srv: { command: 'node', args: ['server.js'] } });
    const collected = collectClaudeMcpServers(dir, [p]);
    expect(collected.srv).toEqual({ command: 'node', args: ['server.js'], env: undefined });
  });

  it('returns empty for a plugin without mcpServers', () => {
    const p = join(dir, 'plain');
    writeManifest(p, {});
    expect(mcpServersFromClaudePlugin(p)).toEqual({});
  });
});
