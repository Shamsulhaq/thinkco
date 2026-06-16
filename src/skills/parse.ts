/** Skill format: a directory containing SKILL.md with frontmatter + body. */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Skill {
  name: string;
  description: string;
  /** Keywords that activate progressive loading of the full body. */
  triggers: string[];
  /** Full instructional body (loaded progressively). */
  body: string;
  /** Absolute directory of the skill. */
  dir: string;
  /** Declared runnable scripts (relative paths within the skill dir). */
  scripts: string[];
  /** Tools pre-approved while this skill is active (Agent Skills `allowed-tools`). */
  allowedTools: string[];
  /** Glob patterns that gate auto-activation to matching files (`paths`). */
  paths: string[];
  /** Model override while active (`model`). */
  model?: string;
  /** Run in a forked subagent context (`context: fork`). */
  contextFork: boolean;
  /** Subagent type when context: fork (`agent`). */
  agent?: string;
}

/** Parse very small YAML-ish frontmatter (key: value, comma lists). */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!text.startsWith('---')) return { meta, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta, body: text };
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\n+/, '');
  for (const line of header.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body };
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Parse a skill from its directory (expects SKILL.md). */
export function parseSkill(dir: string): Skill | undefined {
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return undefined;
  const { meta, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  const name = meta.name ?? dir.split('/').pop() ?? 'skill';
  const scripts = readdirSync(dir).filter((f) => /\.(sh|js|mjs|cjs|ts|py)$/.test(f));
  return {
    name,
    description: meta.description ?? '',
    triggers: splitList(meta.triggers ?? meta.trigger),
    body,
    dir,
    scripts,
    allowedTools: splitList(meta['allowed-tools'] ?? meta.allowedTools),
    paths: splitList(meta.paths),
    model: meta.model || undefined,
    contextFork: (meta.context ?? '').trim() === 'fork',
    agent: meta.agent || undefined,
  };
}

/** Discover skills: each immediate subdirectory of a skills root that has SKILL.md. */
export function discoverSkills(roots: string[]): Skill[] {
  const skills: Skill[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const skill = parseSkill(dir);
      if (skill) skills.push(skill);
    }
  }
  return skills;
}
