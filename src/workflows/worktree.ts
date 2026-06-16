/** Git worktree isolation: run a subagent on its own branch/worktree so parallel work can't clobber. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSubagent, type SubagentOptions, type SubagentResult } from './subagent.js';

/** Runs a git command; injectable for tests. Returns stdout. */
export type GitExec = (args: string[], cwd: string) => string;

const defaultGitExec: GitExec = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();

export interface Worktree {
  path: string;
  branch: string;
  cleanup: () => void;
}

export interface CreateWorktreeOptions {
  repoRoot: string;
  branch: string;
  /** Parent dir for the worktree (defaults to a temp dir). */
  dir?: string;
  gitExec?: GitExec;
}

/** Create an isolated git worktree on a new branch. */
export function createWorktree(opts: CreateWorktreeOptions): Worktree {
  const git = opts.gitExec ?? defaultGitExec;
  const base = opts.dir ?? mkdtempSync(join(tmpdir(), 'thinkco-wt-'));
  const path = join(base, opts.branch.replace(/[^\w.-]+/g, '-'));
  git(['worktree', 'add', '-b', opts.branch, path], opts.repoRoot);
  return {
    path,
    branch: opts.branch,
    cleanup: () => {
      try {
        git(['worktree', 'remove', '--force', path], opts.repoRoot);
      } catch {
        /* ignore */
      }
      if (opts.dir === undefined && existsSync(base)) {
        try {
          rmSync(base, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export interface RunInWorktreeOptions extends Omit<SubagentOptions, 'cwd'> {
  repoRoot: string;
  branch: string;
  gitExec?: GitExec;
  /** Keep the worktree after running (default: remove). */
  keep?: boolean;
}

export interface WorktreeRunResult extends SubagentResult {
  branch: string;
  path: string;
}

/** Create an isolated worktree, run a subagent inside it, then (optionally) clean up. */
export async function runInWorktree(task: string, opts: RunInWorktreeOptions): Promise<WorktreeRunResult> {
  const wt = createWorktree({ repoRoot: opts.repoRoot, branch: opts.branch, gitExec: opts.gitExec });
  try {
    const result = await runSubagent(task, { ...opts, cwd: wt.path });
    return { ...result, branch: wt.branch, path: wt.path };
  } finally {
    if (!opts.keep) wt.cleanup();
  }
}
