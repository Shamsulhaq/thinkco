/** Hooks: run shell commands on agent lifecycle events. */
import { execSync } from 'node:child_process';
import type { ToolCall } from '../types/index.js';

export type HookEvent =
  | 'session-start'
  | 'session-stop'
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'post-edit';

export type HookConfig = Partial<Record<HookEvent, string[]>>;

export type HookExec = (command: string, env: Record<string, string>, cwd: string) => { code: number; output: string };

const defaultExec: HookExec = (command, env, cwd) => {
  try {
    const output = execSync(command, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; message: string; stdout?: string };
    return { code: e.status ?? 1, output: e.stdout ?? e.message };
  }
};

export interface HookRunResult {
  /** True if any pre-tool-use hook vetoed (non-zero exit). */
  block: boolean;
  outputs: string[];
}

export class HookRunner {
  constructor(
    private readonly hooks: HookConfig,
    private readonly cwd: string = process.cwd(),
    private readonly exec: HookExec = defaultExec,
  ) {}

  has(event: HookEvent): boolean {
    return (this.hooks[event]?.length ?? 0) > 0;
  }

  /** Merge additional hooks into this runner at runtime. */
  addHooks(hooks: HookConfig): void {
    for (const [event, commands] of Object.entries(hooks) as Array<[HookEvent, string[]]>) {
      this.hooks[event] = [...(this.hooks[event] ?? []), ...commands];
    }
  }

  /** Run all commands for an event. For pre-tool-use, a non-zero exit blocks the tool. */
  run(event: HookEvent, env: Record<string, string> = {}): HookRunResult {
    const commands = this.hooks[event] ?? [];
    const outputs: string[] = [];
    let block = false;
    for (const command of commands) {
      const { code, output } = this.exec(command, env, this.cwd);
      outputs.push(output.trim());
      if (event === 'pre-tool-use' && code !== 0) block = true;
    }
    return { block, outputs };
  }

  /** Build a beforeTool hook for the agent loop. */
  beforeToolHook(): (call: ToolCall) => Promise<{ block: boolean; reason?: string }> {
    return async (call) => {
      if (!this.has('pre-tool-use')) return { block: false };
      const res = this.run('pre-tool-use', {
        THINKCO_TOOL: call.name,
        THINKCO_INPUT: JSON.stringify(call.input),
      });
      return { block: res.block, reason: res.outputs.join('; ') };
    };
  }

  /** Build an afterTool hook for the agent loop. */
  afterToolHook(): (call: ToolCall, output: string, isError: boolean) => Promise<void> {
    return async (call, _output, isError) => {
      if (this.has('post-tool-use')) {
        this.run('post-tool-use', { THINKCO_TOOL: call.name, THINKCO_ERROR: String(isError) });
      }
      if ((call.name === 'write' || call.name === 'edit') && this.has('post-edit')) {
        this.run('post-edit', { THINKCO_TOOL: call.name, THINKCO_PATH: String(call.input.path ?? '') });
      }
    };
  }
}
