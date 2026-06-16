/** Git tool: a thin, allowlisted wrapper over the git CLI. */
import { z } from 'zod';
import { execFile } from 'node:child_process';
import type { Tool, ToolContext } from '../types.js';

const ALLOWED = new Set([
  'status',
  'diff',
  'log',
  'show',
  'add',
  'commit',
  'branch',
  'checkout',
  'stash',
  'rev-parse',
]);

export const gitTool: Tool<{ subcommand: string; args?: string[] }> = {
  name: 'git',
  description:
    'Run a git subcommand. Allowed: status, diff, log, show, add, commit, branch, checkout, stash, rev-parse.',
  risk: 'execute',
  schema: z.object({
    subcommand: z.string().describe('git subcommand, e.g. "status"'),
    args: z.array(z.string()).optional().describe('Additional arguments'),
  }),
  run: (input, ctx: ToolContext) =>
    new Promise<string>((resolvePromise, reject) => {
      if (!ALLOWED.has(input.subcommand)) {
        reject(new Error(`git subcommand "${input.subcommand}" is not allowed`));
        return;
      }
      execFile(
        'git',
        [input.subcommand, ...(input.args ?? [])],
        { cwd: ctx.cwd, signal: ctx.signal, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && !stdout && !stderr) {
            reject(new Error(err.message));
            return;
          }
          resolvePromise(`${stdout}${stderr}`.trim() || '(no output)');
        },
      );
    }),
};
