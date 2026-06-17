/** Plugin manager: discovery, install, enable/disable state, scaffolding, activation. */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  statSync,
  mkdtempSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseManifest } from './manifest.js';
import { applyPlugin, type PluginSinks, type PluginSummary } from './loader.js';
import { resolveInstallSource } from './registry.js';

interface PluginState {
  enabled: string[];
}

export interface PluginActivationResult {
  name: string;
  summary: PluginSummary;
  loaded: boolean;
  restartRequired: string[];
}

export interface GitHubTreeSource {
  repoUrl: string;
  ref: string;
  subdir: string;
  name: string;
}

export function parseGitHubTreeUrl(source: string): GitHubTreeSource | undefined {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'github.com') return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  const treeIndex = parts.indexOf('tree');
  if (parts.length < 5 || treeIndex !== 2) return undefined;
  const [owner, repo] = parts;
  const ref = parts[treeIndex + 1];
  const subdirParts = parts.slice(treeIndex + 2);
  if (!owner || !repo || !ref || !subdirParts.length) return undefined;
  return {
    repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`,
    ref,
    subdir: subdirParts.join('/'),
    name: subdirParts[subdirParts.length - 1]!,
  };
}

export class PluginManager {
  constructor(private readonly pluginsDir: string) {}

  private statePath(): string {
    return join(this.pluginsDir, 'state.json');
  }

  private readState(): PluginState {
    const p = this.statePath();
    if (!existsSync(p)) return { enabled: [] };
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as PluginState;
    } catch {
      return { enabled: [] };
    }
  }

  private writeState(state: PluginState): void {
    mkdirSync(this.pluginsDir, { recursive: true });
    writeFileSync(this.statePath(), JSON.stringify(state, null, 2));
  }

  /** All installed plugin directories (those containing plugin.json). */
  list(): string[] {
    if (!existsSync(this.pluginsDir)) return [];
    return readdirSync(this.pluginsDir).filter((entry) => {
      const dir = join(this.pluginsDir, entry);
      try {
        return statSync(dir).isDirectory() && existsSync(join(dir, 'plugin.json'));
      } catch {
        return false;
      }
    });
  }

  isEnabled(name: string): boolean {
    return this.readState().enabled.includes(name);
  }

  dirFor(name: string): string {
    return join(this.pluginsDir, name);
  }

  enable(name: string): void {
    const state = this.readState();
    if (!state.enabled.includes(name)) state.enabled.push(name);
    this.writeState(state);
  }

  disable(name: string): void {
    const state = this.readState();
    state.enabled = state.enabled.filter((n) => n !== name);
    this.writeState(state);
  }

  /** Install a plugin from a registry name, local directory, or git URL. Returns the installed name. */
  install(source: string, opts: { enable?: boolean } = {}): string {
    mkdirSync(this.pluginsDir, { recursive: true });
    const resolved = resolveInstallSource(source);
    let name: string;
    if (/^(https?:\/\/|git@)/.test(resolved)) {
      const tree = parseGitHubTreeUrl(resolved);
      if (tree) {
        const tmp = mkdtempSync(join(tmpdir(), 'thinkco-plugin-'));
        try {
          const repoDir = join(tmp, 'repo');
          this.clone(tree.repoUrl, repoDir, tree.ref);
          const sourceDir = join(repoDir, tree.subdir);
          if (!existsSync(sourceDir)) {
            throw new Error(`GitHub tree path not found after clone: ${tree.subdir}`);
          }
          name = this.installDirectory(sourceDir, opts);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      } else {
        name = basename(resolved).replace(/\.git$/, '');
        const dest = join(this.pluginsDir, name);
        if (existsSync(join(dest, 'plugin.json'))) {
          if (opts.enable !== false) this.enable(name);
          return name;
        }
        this.clone(resolved, dest);
        if (!existsSync(join(dest, 'plugin.json'))) {
          rmSync(dest, { recursive: true, force: true });
          throw new Error(`No plugin.json found at cloned repository root. Use a GitHub /tree/<branch>/<path> URL for a plugin subdirectory, or pass a local path containing plugin.json.`);
        }
      }
    } else {
      name = this.installDirectory(resolved, opts);
      return name;
    }
    if (opts.enable !== false) this.enable(name);
    return name;
  }

  private clone(source: string, dest: string, branch?: string): void {
    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    args.push(source, dest);
    // Non-interactive clone: never prompt for credentials (which would hang a TUI), fail fast.
    execFileSync('git', args, {
      stdio: 'ignore',
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' },
    });
  }

  private installDirectory(sourceDir: string, opts: { enable?: boolean }): string {
    if (!existsSync(join(sourceDir, 'plugin.json'))) {
      throw new Error(`No plugin.json found at ${sourceDir}`);
    }
    const name = parseManifest(sourceDir).manifest.name;
    if (!existsSync(join(this.pluginsDir, name, 'plugin.json'))) {
      cpSync(sourceDir, join(this.pluginsDir, name), { recursive: true });
    }
    if (opts.enable !== false) this.enable(name);
    return name;
  }

  /** Enable and apply an installed plugin into live registries. MCP servers still require restart. */
  activate(name: string, sinks: PluginSinks): PluginActivationResult {
    this.enable(name);
    const summary = applyPlugin(parseManifest(this.dirFor(name)), {
      ...sinks,
      // Runtime MCP startup is intentionally not attempted here. Existing MCP managers own
      // child-process lifecycle, so new servers are picked up on the next launch.
      addMcpServer: undefined,
    });
    return {
      name,
      summary,
      loaded: true,
      restartRequired: summary.mcpServers.length ? ['mcpServers'] : [],
    };
  }

  /** Install, enable, and apply a plugin into live registries. */
  installAndActivate(source: string, sinks: PluginSinks): PluginActivationResult {
    const name = this.install(source);
    return this.activate(name, sinks);
  }

  /** Remove an installed plugin. */
  remove(name: string): void {
    this.disable(name);
    const dir = join(this.pluginsDir, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  /** Apply all enabled plugins, registering their components into the given sinks. */
  loadEnabled(sinks: PluginSinks): PluginSummary[] {
    const enabled = new Set(this.readState().enabled);
    const summaries: PluginSummary[] = [];
    for (const name of this.list()) {
      if (!enabled.has(name)) continue;
      try {
        summaries.push(applyPlugin(parseManifest(join(this.pluginsDir, name)), sinks));
      } catch {
        // Skip malformed plugins.
      }
    }
    return summaries;
  }

  /** Scaffold a new plugin skeleton (manifest + sample command + skill). */
  scaffold(name: string): string {
    const dir = join(this.pluginsDir, name);
    mkdirSync(join(dir, 'commands'), { recursive: true });
    mkdirSync(join(dir, 'skills', 'example'), { recursive: true });

    const manifest = {
      name,
      version: '0.1.0',
      description: `The ${name} plugin`,
      commands: ['commands'],
      skills: ['skills/example'],
      mcpServers: {},
      hooks: {},
    };
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(
      join(dir, 'commands', 'hello.md'),
      '---\nname: hello\ndescription: Sample command\n---\nGreet the user about: $ARGUMENTS',
    );
    writeFileSync(
      join(dir, 'skills', 'example', 'SKILL.md'),
      `---\nname: ${name}-example\ndescription: Example skill\ntriggers: example\n---\nExample skill instructions.`,
    );
    return dir;
  }
}
