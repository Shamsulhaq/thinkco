/** Adapter for Claude Code-format plugins: load .claude/agents/*.md as skills, commands as commands. */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { parseFrontmatter, type Skill } from '../skills/parse.js';
import { parseCommandFile, substituteTemplate, type ExecFn } from '../commands/custom.js';
import type { SlashCommand } from '../agent/commands.js';

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Recursively collect *.md files under a directory. */
function walkMarkdown(dir: string, limit = 2000): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = join(d, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith('.md') && entry !== 'README.md') out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Derive activation triggers from an agent name (e.g. "code-analyzer" → analyzer, code). */
function triggersFor(name: string): string[] {
  const parts = name.split(/[-_\s]+/).filter((p) => p.length > 2);
  return Array.from(new Set([name, ...parts]));
}

/** Convert a Claude Code agent markdown file into a thinkco Skill. */
export function agentFileToSkill(file: string): Skill | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const { meta, body } = parseFrontmatter(text);
  const name = (meta.name ?? basename(file, '.md')).trim();
  if (!name) return undefined;
  return {
    name,
    description: meta.description ?? '',
    triggers: triggersFor(name),
    body,
    dir: dirname(file),
    scripts: [],
    // Claude Code agents declare `tools:`; treat them as pre-approved while active.
    allowedTools: splitList(meta.tools),
    paths: [],
    model: meta.model || undefined,
    contextFork: false,
  };
}

/** Load all agents under <claudeDir>/agents as skills. */
export function loadClaudeAgents(claudeDir: string): Skill[] {
  const agentsDir = join(claudeDir, 'agents');
  if (!existsSync(agentsDir)) return [];
  const skills: Skill[] = [];
  const seen = new Set<string>();
  for (const file of walkMarkdown(agentsDir)) {
    const skill = agentFileToSkill(file);
    if (skill && !seen.has(skill.name)) {
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills;
}

/** Load all commands under <claudeDir>/commands as SlashCommands. */
export function loadClaudeCommands(claudeDir: string, exec?: ExecFn): SlashCommand[] {
  const commandsDir = join(claudeDir, 'commands');
  if (!existsSync(commandsDir)) return [];
  const commands: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const file of walkMarkdown(commandsDir)) {
    const def = parseCommandFile(file);
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    commands.push({
      name: def.name,
      description: def.description,
      run: (ctx) => ({ handled: true, prompt: substituteTemplate(def.template, ctx.args, { exec }) }),
    });
  }
  return commands;
}

export interface ClaudePluginContent {
  skills: Skill[];
  commands: SlashCommand[];
}

/**
 * Load a Claude Code-format plugin from a directory. Accepts either the plugin root
 * (containing a `.claude/` directory) or a `.claude/` directory itself.
 */
export function loadClaudePlugin(pluginDir: string, exec?: ExecFn): ClaudePluginContent {
  const claudeDir = existsSync(join(pluginDir, '.claude')) ? join(pluginDir, '.claude') : pluginDir;
  return {
    skills: loadClaudeAgents(claudeDir),
    commands: loadClaudeCommands(claudeDir, exec),
  };
}
