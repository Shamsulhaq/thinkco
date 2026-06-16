/** Search tools: glob (find files) and grep (search content). */
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { walkFiles, matchGlob } from '../glob.js';

function resolveRoot(ctx: ToolContext, p?: string): string {
  if (!p) return ctx.cwd;
  return isAbsolute(p) ? p : resolve(ctx.cwd, p);
}

export const globTool: Tool<{ pattern: string; path?: string; limit?: number }> = {
  name: 'glob',
  description:
    'Find files matching a glob pattern (e.g. "src/**/*.ts"). Respects .gitignore and skips node_modules/.git/dist.',
  risk: 'read',
  schema: z.object({
    pattern: z.string().describe('Glob pattern relative to search root'),
    path: z.string().optional().describe('Root directory (defaults to cwd)'),
    limit: z.number().int().positive().optional(),
  }),
  run: async (input, ctx) => {
    const root = resolveRoot(ctx, input.path);
    const files = walkFiles({ root, match: input.pattern, limit: input.limit ?? 1000 });
    return files.length ? files.join('\n') : '(no matches)';
  },
};

export const grepTool: Tool<{
  pattern: string;
  path?: string;
  include?: string;
  ignoreCase?: boolean;
  maxMatches?: number;
}> = {
  name: 'grep',
  description:
    'Search file contents by regular expression. Returns file:line:match. Respects .gitignore.',
  risk: 'read',
  schema: z.object({
    pattern: z.string().describe('Regular expression'),
    path: z.string().optional(),
    include: z.string().optional().describe('Only search files matching this glob'),
    ignoreCase: z.boolean().optional(),
    maxMatches: z.number().int().positive().optional(),
  }),
  run: async (input, ctx) => {
    const root = resolveRoot(ctx, input.path);
    let re: RegExp;
    try {
      re = new RegExp(input.pattern, input.ignoreCase ? 'i' : undefined);
    } catch (err) {
      throw new Error(`Invalid regex: ${(err as Error).message}`);
    }
    const files = walkFiles({ root, limit: 5000 });
    const max = input.maxMatches ?? 200;
    const out: string[] = [];
    for (const rel of files) {
      if (input.include && !matchGlob(input.include, rel)) continue;
      let content: string;
      try {
        content = readFileSync(join(root, rel), 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          out.push(`${rel}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`);
          if (out.length >= max) return out.join('\n');
        }
      }
    }
    return out.length ? out.join('\n') : '(no matches)';
  },
};

export const searchTools = [globTool, grepTool];
