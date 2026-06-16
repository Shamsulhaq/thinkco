import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from '../src/plugins/manifest.js';
import { loadPlugin } from '../src/plugins/loader.js';
import { PluginManager } from '../src/plugins/manager.js';
import type { SlashCommand } from '../src/agent/commands.js';
import type { Skill } from '../src/skills/parse.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thinkco-plugins-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Build a complete sample plugin directory. */
function makePlugin(dir: string, name: string) {
  mkdirSync(join(dir, 'commands'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      commands: ['commands'],
      skills: ['skills/demo'],
      mcpServers: { calc: { command: 'python3', args: ['-m', 'server'] } },
      hooks: { 'post-edit': ['prettier --write $THINKCO_PATH'] },
    }),
  );
  writeFileSync(join(dir, 'commands', 'review.md'), 'Review: $ARGUMENTS');
  writeFileSync(
    join(dir, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo\ntriggers: demo\n---\nDemo body',
  );
}

describe('plugin manifest', () => {
  it('parses a valid manifest', () => {
    const dir = join(root, 'p');
    makePlugin(dir, 'myplugin');
    const { manifest } = parseManifest(dir);
    expect(manifest.name).toBe('myplugin');
    expect(manifest.mcpServers.calc?.command).toBe('python3');
  });

  it('throws on missing manifest', () => {
    expect(() => parseManifest(join(root, 'nope'))).toThrow(/No plugin.json/);
  });
});

describe('plugin loader registers all component types', () => {
  it('wires commands, skills, mcp servers, and hooks into sinks', () => {
    const dir = join(root, 'p');
    makePlugin(dir, 'full');

    const commands: SlashCommand[] = [];
    const skills: Skill[] = [];
    const mcp: string[] = [];
    let hooks: Record<string, string[]> = {};

    const summary = loadPlugin(dir, {
      registerCommand: (c) => commands.push(c),
      addSkill: (s) => skills.push(s),
      addMcpServer: (name) => mcp.push(name),
      addHooks: (h) => (hooks = h as Record<string, string[]>),
    });

    expect(commands.map((c) => c.name)).toContain('review');
    expect(skills.map((s) => s.name)).toContain('demo');
    expect(mcp).toContain('calc');
    expect(hooks['post-edit']).toBeDefined();
    expect(summary.name).toBe('full');
  });
});

describe('PluginManager lifecycle', () => {
  it('scaffolds, then loads the scaffolded plugin when enabled', () => {
    const mgr = new PluginManager(join(root, 'installed'));
    mgr.scaffold('starter');
    expect(mgr.list()).toContain('starter');

    // Not enabled yet → nothing loaded.
    expect(mgr.loadEnabled({})).toEqual([]);

    mgr.enable('starter');
    const summaries = mgr.loadEnabled({});
    expect(summaries[0]?.name).toBe('starter');
  });

  it('installs a plugin from a local directory and enables it', () => {
    const src = join(root, 'src-plugin');
    makePlugin(src, 'shipped');
    const mgr = new PluginManager(join(root, 'installed'));
    const name = mgr.install(src);
    expect(name).toBe('shipped');
    expect(mgr.isEnabled('shipped')).toBe(true);
    expect(mgr.list()).toContain('shipped');
  });

  it('disable and remove work', () => {
    const src = join(root, 'src2');
    makePlugin(src, 'temp');
    const mgr = new PluginManager(join(root, 'installed'));
    mgr.install(src);
    mgr.disable('temp');
    expect(mgr.isEnabled('temp')).toBe(false);
    mgr.remove('temp');
    expect(mgr.list()).not.toContain('temp');
  });

  it('rejects installing a directory without a manifest', () => {
    const mgr = new PluginManager(join(root, 'installed'));
    mkdirSync(join(root, 'empty'));
    expect(() => mgr.install(join(root, 'empty'))).toThrow(/No plugin.json/);
  });
});

describe('plugin registry resolution', () => {
  it('resolves a known built-in to its bundled local dir (offline, no git)', async () => {
    const { resolveInstallSource } = await import('../src/plugins/registry.js');
    const resolved = resolveInstallSource('code-review');
    expect(resolved.endsWith('/plugins/code-review')).toBe(true);
  });

  it('passes through git URLs and local paths unchanged', async () => {
    const { resolveInstallSource } = await import('../src/plugins/registry.js');
    expect(resolveInstallSource('https://github.com/x/y')).toBe('https://github.com/x/y');
    expect(resolveInstallSource('./local/path')).toBe('./local/path');
  });

  it('throws a helpful error for an unknown name', async () => {
    const { resolveInstallSource } = await import('../src/plugins/registry.js');
    expect(() => resolveInstallSource('nope-not-real')).toThrow(/Unknown plugin/);
  });

  it('installs a built-in registry plugin offline by name', () => {
    const mgr = new PluginManager(join(root, 'installed'));
    const name = mgr.install('conventional-commits');
    expect(name).toBe('conventional-commits');
    expect(mgr.isEnabled('conventional-commits')).toBe(true);
    mgr.enable('conventional-commits');
    const summaries = mgr.loadEnabled({});
    expect(summaries.find((s) => s.name === 'conventional-commits')?.skills).toContain('conventional-commits');
  });
});
