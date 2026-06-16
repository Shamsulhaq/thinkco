/** Plugin loader: register a plugin's components into the right subsystems. */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseManifest, type LoadedManifest } from './manifest.js';
import { loadCustomCommands } from '../commands/custom.js';
import { parseSkill, type Skill } from '../skills/parse.js';
import type { SlashCommand } from '../agent/commands.js';
import type { McpServerConfig } from '../mcp/manager.js';
import type { HookConfig } from '../workflows/hooks.js';

/** Subsystems a plugin registers into. All optional so callers wire what they need. */
export interface PluginSinks {
  registerCommand?: (cmd: SlashCommand) => void;
  addSkill?: (skill: Skill) => void;
  addMcpServer?: (name: string, config: McpServerConfig) => void;
  addHooks?: (hooks: HookConfig) => void;
}

export interface PluginSummary {
  name: string;
  version: string;
  commands: string[];
  skills: string[];
  mcpServers: string[];
  hooks: string[];
}

/** Load one plugin from a parsed manifest, registering its components. */
export function applyPlugin(loaded: LoadedManifest, sinks: PluginSinks): PluginSummary {
  const { manifest, dir } = loaded;
  const summary: PluginSummary = {
    name: manifest.name,
    version: manifest.version,
    commands: [],
    skills: [],
    mcpServers: [],
    hooks: [],
  };

  // Commands.
  for (const rel of manifest.commands) {
    const path = join(dir, rel);
    if (!existsSync(path)) continue;
    for (const cmd of loadCustomCommands(path.endsWith('.md') ? dir : path)) {
      // If a specific file was given, only register the matching command.
      if (rel.endsWith('.md') && cmd.name !== rel.replace(/.*\//, '').replace(/\.md$/, '')) continue;
      sinks.registerCommand?.(cmd);
      summary.commands.push(cmd.name);
    }
  }

  // Skills.
  for (const rel of manifest.skills) {
    const skill = parseSkill(join(dir, rel));
    if (skill) {
      sinks.addSkill?.(skill);
      summary.skills.push(skill.name);
    }
  }

  // MCP servers.
  for (const [name, cfg] of Object.entries(manifest.mcpServers)) {
    sinks.addMcpServer?.(name, cfg);
    summary.mcpServers.push(name);
  }

  // Hooks.
  if (Object.keys(manifest.hooks).length) {
    sinks.addHooks?.(manifest.hooks as HookConfig);
    summary.hooks = Object.keys(manifest.hooks);
  }

  return summary;
}

/** Convenience: parse a directory's manifest and apply it. */
export function loadPlugin(dir: string, sinks: PluginSinks): PluginSummary {
  return applyPlugin(parseManifest(dir), sinks);
}
