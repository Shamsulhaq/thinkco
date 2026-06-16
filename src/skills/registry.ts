/** Skill registry: catalog for the system prompt + progressive activation by relevance. */
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import type { Skill } from './parse.js';
import type { Tool } from '../tools/types.js';
import { matchGlob } from '../tools/glob.js';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor(skills: Skill[] = []) {
    skills.forEach((s) => this.add(s));
  }

  add(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** Short always-on catalog (name + description) injected into the system prompt. */
  catalog(): string {
    if (this.skills.size === 0) return '';
    const lines = this.list().map((s) => `- ${s.name}: ${s.description}`);
    return `Available skills (ask to use, or they activate on relevant requests):\n${lines.join('\n')}`;
  }

  /** Progressive loading: return full bodies of skills whose triggers match the query. */
  activate(query: string): Skill[] {
    const q = query.toLowerCase();
    const tokens = query.split(/\s+/);
    return this.list().filter((s) => {
      const triggerMatch = s.triggers.some((t) => q.includes(t.toLowerCase()));
      if (s.paths.length > 0) {
        // Path-gated skills activate only when working with matching files (or an explicit trigger).
        const pathMatch = tokens.some((tok) =>
          s.paths.some((p) => matchGlob(p, tok.replace(/^@/, ''))),
        );
        return triggerMatch || pathMatch;
      }
      if (triggerMatch) return true;
      return s.name.toLowerCase().split(/\W+/).some((w) => w.length > 3 && q.includes(w));
    });
  }

  /** Tools pre-approved by the skills activated for a query. */
  activeAllowedTools(query: string): string[] {
    return [...new Set(this.activate(query).flatMap((s) => s.allowedTools))];
  }

  /** Build the prompt addition for a given user query (catalog + any activated bodies). */
  promptFor(query: string): string {
    const parts: string[] = [];
    const catalog = this.catalog();
    if (catalog) parts.push(catalog);
    for (const skill of this.activate(query)) {
      parts.push(`# Skill: ${skill.name}\n${skill.body}`);
    }
    return parts.join('\n\n');
  }
}

const INTERPRETERS: Record<string, string[]> = {
  '.sh': ['sh'],
  '.js': ['node'],
  '.mjs': ['node'],
  '.cjs': ['node'],
  '.py': ['python3'],
};

/** Expose a skill's runnable script as a tool named skill__<skill>__<script>. */
export function skillScriptTool(skill: Skill, script: string): Tool<{ args?: string[] }> {
  const ext = extname(script);
  const interp = INTERPRETERS[ext];
  return {
    name: `skill__${skill.name}__${script.replace(/\W+/g, '_')}`,
    description: `Run the ${script} script from skill "${skill.name}".`,
    risk: 'execute',
    schema: z.object({ args: z.array(z.string()).optional() }),
    run: (input, ctx) =>
      new Promise<string>((resolvePromise) => {
        const scriptPath = join(skill.dir, script);
        const cmd = interp ? interp[0]! : scriptPath;
        const cmdArgs = interp ? [scriptPath, ...(input.args ?? [])] : (input.args ?? []);
        const child = spawn(cmd, cmdArgs, { cwd: ctx.cwd, signal: ctx.signal });
        let out = '';
        child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
        child.stderr?.on('data', (c: Buffer) => (out += c.toString()));
        child.on('error', (err) => resolvePromise(`Failed to run script: ${err.message}`));
        child.on('close', (code) => resolvePromise(`${out}\n[exit code: ${code ?? 'null'}]`));
      }),
  };
}

/** Register all runnable scripts of the given skills into a tool registry. */
export function registerSkillScripts(
  skills: Skill[],
  register: (tool: Tool<unknown>) => void,
): string[] {
  const names: string[] = [];
  for (const skill of skills) {
    for (const script of skill.scripts) {
      const tool = skillScriptTool(skill, script) as Tool<unknown>;
      register(tool);
      names.push(tool.name);
    }
  }
  return names;
}
