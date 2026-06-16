/** Persistent, tree-shaped task tracking (T1, T1.1, …) with per-task progress logs. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type TaskStatus = 'pending' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string; // T1, T1.1, T2 …
  parent?: string;
  description: string;
  status: TaskStatus;
  /** Task ids that must be `done` before this one can start. */
  dependsOn?: string[];
  priority?: TaskPriority;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** Tree task store persisted under `.thinkco/tasks/`. */
export class TaskStore {
  readonly dir: string;
  private tasks: Task[] = [];

  constructor(cwd: string) {
    this.dir = join(cwd, '.thinkco', 'tasks');
    this.load();
  }

  private indexFile(): string {
    return join(this.dir, 'tasks.json');
  }

  private load(): void {
    try {
      if (existsSync(this.indexFile())) this.tasks = JSON.parse(readFileSync(this.indexFile(), 'utf8')) as Task[];
    } catch {
      this.tasks = [];
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.indexFile(), JSON.stringify(this.tasks, null, 2));
  }

  /** Allocate the next tree id under an optional parent (T1, T1.1, …). */
  private nextId(parent?: string): string {
    const siblings = this.tasks.filter((t) => t.parent === parent);
    if (!parent) return `T${siblings.length + 1}`;
    return `${parent}.${siblings.length + 1}`;
  }

  add(description: string, parent?: string, opts: { dependsOn?: string[]; priority?: TaskPriority } = {}): Task {
    if (parent && !this.tasks.some((t) => t.id === parent)) {
      throw new Error(`Unknown parent task "${parent}"`);
    }
    const deps = (opts.dependsOn ?? []).filter((d) => this.tasks.some((t) => t.id === d));
    const task: Task = {
      id: this.nextId(parent),
      parent,
      description,
      status: 'pending',
      ...(deps.length ? { dependsOn: deps } : {}),
      ...(opts.priority ? { priority: opts.priority } : {}),
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  /** True if a task is blocked by an unfinished dependency. */
  isBlocked(id: string): boolean {
    const t = this.tasks.find((x) => x.id === id);
    if (!t?.dependsOn?.length) return false;
    return t.dependsOn.some((d) => this.tasks.find((x) => x.id === d)?.status !== 'done');
  }

  /** The next actionable task: highest priority, unblocked, not done. */
  next(): Task | undefined {
    const actionable = this.tasks
      .filter((t) => t.status !== 'done' && !this.isBlocked(t.id))
      // only leaf-level work (skip parents that still have open children)
      .filter((t) => !this.tasks.some((c) => c.parent === t.id && c.status !== 'done'));
    actionable.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority ?? 'medium'];
      const pb = PRIORITY_RANK[b.priority ?? 'medium'];
      if (pa !== pb) return pa - pb;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    return actionable[0];
  }

  setStatus(id: string, status: TaskStatus): boolean {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return false;
    task.status = status;
    this.save();
    return true;
  }

  remove(id: string): number {
    const before = this.tasks.length;
    // Remove the task and its descendants.
    this.tasks = this.tasks.filter((t) => t.id !== id && !t.id.startsWith(`${id}.`));
    this.save();
    return before - this.tasks.length;
  }

  list(): Task[] {
    return [...this.tasks];
  }

  open(): Task[] {
    return this.tasks.filter((t) => t.status !== 'done');
  }

  clear(): void {
    this.tasks = [];
    this.save();
  }

  appendProgress(id: string, text: string): boolean {
    if (!this.tasks.some((t) => t.id === id)) return false;
    const dir = join(this.dir, id);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'progress.md'), `- ${new Date().toISOString()}: ${text.trim()}\n`);
    return true;
  }

  progress(id: string): string {
    const file = join(this.dir, id, 'progress.md');
    try {
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    } catch {
      return '';
    }
  }

  /** Render the task tree as an indented checklist. */
  render(): string {
    if (this.tasks.length === 0) return '(no tasks)';
    const box = (s: TaskStatus) => (s === 'done' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]');
    const sorted = [...this.tasks].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return sorted
      .map((t) => {
        const indent = '  '.repeat(t.id.match(/\./g)?.length ?? 0);
        const tags = [
          t.priority && t.priority !== 'medium' ? `!${t.priority}` : '',
          t.dependsOn?.length ? `needs ${t.dependsOn.join(',')}` : '',
          this.isBlocked(t.id) ? 'BLOCKED' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `${indent}${box(t.status)} ${t.id}: ${t.description}${tags ? `  (${tags})` : ''}`;
      })
      .join('\n');
  }

  /** A compact one-line-per-open-task summary for checkpoints. */
  openSummary(): string {
    const open = this.open();
    if (open.length === 0) return '';
    return open.map((t) => `${t.id} (${t.status}): ${t.description}`).join('\n');
  }
}
