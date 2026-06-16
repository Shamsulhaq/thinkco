/** Shell execution tool with streaming output and timeout. */
import { z } from 'zod';
import { spawn } from 'node:child_process';
import type { Tool, ToolContext } from '../types.js';

export const shellTool: Tool<{ command: string; cwd?: string; timeoutMs?: number }> = {
  name: 'shell',
  description: 'Run a shell command and return its combined stdout/stderr and exit code.',
  risk: 'execute',
  schema: z.object({
    command: z.string().describe('Command line to execute'),
    cwd: z.string().optional().describe('Working directory'),
    timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds'),
  }),
  run: (input, ctx: ToolContext) =>
    new Promise<string>((resolvePromise) => {
      const timeout = input.timeoutMs ?? 120_000;
      const child = spawn(input.command, {
        shell: true,
        cwd: input.cwd ?? ctx.cwd,
        signal: ctx.signal,
      });

      let out = '';
      let killedByTimeout = false;
      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGKILL');
      }, timeout);

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        out += text;
        ctx.emit?.(text);
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolvePromise(`Failed to start command: ${err.message}`);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const trimmed = out.length > 30_000 ? `${out.slice(0, 30_000)}\n…(truncated)` : out;
        const suffix = killedByTimeout
          ? `\n[killed: exceeded ${timeout}ms]`
          : `\n[exit code: ${code ?? 'null'}]`;
        resolvePromise(`${trimmed}${suffix}`);
      });
    }),
};
