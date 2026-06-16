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
} from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseManifest } from './manifest.js';
import { applyPlugin, type PluginSinks, type PluginSummary } from './loader.js';
import { resolveInstallSource } from './registry.js';

interface PluginState {
  enabled: string[];
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
      name = basename(resolved).replace(/\.git$/, '');
      const dest = join(this.pluginsDir, name);
      // Non-interactive clone: never prompt for credentials (which would hang a TUI), fail fast.
      execFileSync('git', ['clone', '--depth', '1', resolved, dest], {
        stdio: 'ignore',
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' },
      });
    } else {
      if (!existsSync(join(resolved, 'plugin.json'))) {
        throw new Error(`No plugin.json found at ${resolved}`);
      }
      name = parseManifest(resolved).manifest.name;
      cpSync(resolved, join(this.pluginsDir, name), { recursive: true });
    }
    if (opts.enable !== false) this.enable(name);
    return name;
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
