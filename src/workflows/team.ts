/** Agent teams: run multiple specialized subagents concurrently and collect their results. */
import type { ProviderAdapter } from '../types/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import { runSubagent } from './subagent.js';
import { runInWorktree, type GitExec } from './worktree.js';

export interface TeamMember {
  /** Identifier for the member's result. */
  name: string;
  /** The subtask delegated to this member. */
  task: string;
  /** Optional role/system prompt specializing the member. */
  system?: string;
}

export interface TeamOptions {
  provider: ProviderAdapter;
  model: string;
  tools: ToolRegistry;
  cwd?: string;
  maxIterations?: number;
  /** Cap on concurrent members (default: all at once). */
  concurrency?: number;
  /** Run each member in an isolated git worktree on its own branch. */
  isolate?: { repoRoot: string; gitExec?: GitExec; branchPrefix?: string };
}

export interface TeamMemberResult {
  name: string;
  text: string;
  toolCalls: number;
  branch?: string;
  error?: string;
}

/** Run all members; returns results in input order. Errors are captured per-member. */
export async function runTeam(members: TeamMember[], opts: TeamOptions): Promise<TeamMemberResult[]> {
  const limit = opts.concurrency ?? members.length;
  const results: TeamMemberResult[] = new Array(members.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= members.length) return;
      const m = members[i]!;
      try {
        if (opts.isolate) {
          const branch = `${opts.isolate.branchPrefix ?? 'thinkco/team'}/${m.name}`;
          const r = await runInWorktree(m.task, {
            provider: opts.provider,
            model: opts.model,
            tools: opts.tools,
            system: m.system,
            maxIterations: opts.maxIterations,
            repoRoot: opts.isolate.repoRoot,
            branch,
            gitExec: opts.isolate.gitExec,
            keep: true,
          });
          results[i] = { name: m.name, text: r.text, toolCalls: r.toolCalls, branch: r.branch };
        } else {
          const r = await runSubagent(m.task, {
            provider: opts.provider,
            model: opts.model,
            tools: opts.tools,
            system: m.system,
            cwd: opts.cwd,
            maxIterations: opts.maxIterations,
          });
          results[i] = { name: m.name, text: r.text, toolCalls: r.toolCalls };
        }
      } catch (err) {
        results[i] = { name: m.name, text: '', toolCalls: 0, error: (err as Error).message };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, members.length) }, () => worker()));
  return results;
}
