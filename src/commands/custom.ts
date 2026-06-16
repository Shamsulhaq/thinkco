/** Custom commands: templated markdown files in .thinkco/commands/*.md. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { parseFrontmatter } from '../skills/parse.js';
import type { SlashCommand } from '../agent/commands.js';

export interface CustomCommandDef {
  name: string;
  description: string;
  template: string;
}

export type ExecFn = (command: string, cwd: string) => string;

const defaultExec: ExecFn = (command, cwd) => {
  try {
    return execSync(command, { cwd, encoding: 'utf8', timeout: 30_000 }).trim();
  } catch (err) {
    return `[command failed: ${(err as Error).message}]`;
  }
};

/**
 * Substitute template placeholders:
 *   $ARGUMENTS or {{args}}  → full argument string
 *   $1, $2, ...             → positional arguments (whitespace-split)
 *   !`cmd`                  → stdout of running cmd
 */
export function substituteTemplate(
  template: string,
  argString: string,
  opts: { cwd?: string; exec?: ExecFn; argNames?: string[] } = {},
): string {
  const exec = opts.exec ?? defaultExec;
  const cwd = opts.cwd ?? process.cwd();
  const positionals = argString.trim().length ? argString.trim().split(/\s+/) : [];

  let out = template;
  // Fenced multi-line bash blocks: ```!\n<cmds>\n``` → command output.
  out = out.replace(/```!\s*\n([\s\S]*?)```/g, (_m, cmds: string) => exec(cmds.trim(), cwd));
  // Inline bash injection: !`cmd` → stdout.
  out = out.replace(/!`([^`]+)`/g, (_m, cmd: string) => exec(cmd, cwd));
  // Full-argument placeholders.
  // Indexed placeholders FIRST: $ARGUMENTS[N] (0-based, Agent Skills standard).
  out = out.replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, n: string) => positionals[Number(n)] ?? '');
  // Then bare full-argument placeholders.
  out = out.replace(/\$ARGUMENTS\b/g, argString).replace(/\{\{\s*args\s*\}\}/g, argString);
  // Named arguments from frontmatter `arguments: [a, b]` mapped by position.
  if (opts.argNames) {
    for (let i = 0; i < opts.argNames.length; i++) {
      const name = opts.argNames[i]!;
      out = out.replace(new RegExp(`\\$${name}\\b`, 'g'), positionals[i] ?? '');
    }
  }
  // Positional placeholders: $1, $2 (1-based, thinkco convention).
  out = out.replace(/\$(\d+)/g, (_m, n: string) => positionals[Number(n) - 1] ?? '');
  return out;
}

/** Parse a single command markdown file into a definition. */
export function parseCommandFile(path: string): CustomCommandDef {
  const raw = readFileSync(path, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const name = meta.name ?? basename(path).replace(/\.md$/, '');
  return { name, description: meta.description ?? `Custom command: ${name}`, template: body.trim() };
}

/** Load all custom commands from a directory as SlashCommands that emit agent prompts. */
export function loadCustomCommands(dir: string, exec: ExecFn = defaultExec): SlashCommand[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const def = parseCommandFile(join(dir, f));
      const command: SlashCommand = {
        name: def.name,
        description: def.description,
        run: (ctx) => ({
          handled: true,
          prompt: substituteTemplate(def.template, ctx.args, { exec }),
        }),
      };
      return command;
    });
}
