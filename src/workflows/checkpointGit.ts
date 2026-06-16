/** Opt-in git working-tree snapshots so `/undo` can restore what the agent changed. */
import { execFileSync } from 'node:child_process';

export type GitExec = (args: string[], cwd: string) => string;

const defaultExec: GitExec = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();

/** Captures working-tree snapshots (via `git stash create`) and restores them on demand. */
export class GitSnap {
  private readonly stack: string[] = [];
  constructor(
    private readonly cwd: string,
    private readonly exec: GitExec = defaultExec,
  ) {}

  private inRepo(): boolean {
    try {
      return this.exec(['rev-parse', '--is-inside-work-tree'], this.cwd) === 'true';
    } catch {
      return false;
    }
  }

  /** Snapshot the working tree WITHOUT changing it; returns the SHA, or '' if nothing/no repo. */
  snapshot(): string {
    if (!this.inRepo()) return '';
    try {
      this.exec(['add', '-A'], this.cwd);
      const sha = this.exec(['stash', 'create'], this.cwd).trim();
      if (sha) {
        this.stack.push(sha);
        if (this.stack.length > 20) this.stack.shift();
      }
      return sha;
    } catch {
      return '';
    }
  }

  /** Restore the most recent snapshot's tracked files. Returns the restored SHA, or ''. */
  undo(): string {
    const sha = this.stack.pop();
    if (!sha) return '';
    try {
      this.exec(['checkout', sha, '--', '.'], this.cwd);
      return sha;
    } catch {
      return '';
    }
  }

  depth(): number {
    return this.stack.length;
  }
}
