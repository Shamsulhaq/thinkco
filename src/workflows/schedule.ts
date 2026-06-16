/** Scheduled tasks: run headless prompts on a recurring interval. Foreground runner (no daemon). */

export interface ScheduleEntry {
  id: string;
  /** Interval like "30s", "15m", "2h", "1d". */
  every: string;
  /** The prompt to run headlessly when due. */
  prompt: string;
}

/** Parse an interval string into milliseconds. Returns null if invalid. */
export function parseInterval(spec: string): number | null {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(spec.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

export type TaskRunner = (prompt: string) => Promise<void>;

export interface SchedulerOptions {
  /** Returns the current epoch ms; injectable for tests. */
  now?: () => number;
}

interface TrackedTask {
  entry: ScheduleEntry;
  intervalMs: number;
  nextDue: number;
}

/** Tracks schedule entries and runs them when due. Drive it by calling tick(). */
export class Scheduler {
  private readonly tasks: TrackedTask[] = [];
  private readonly now: () => number;

  constructor(entries: ScheduleEntry[], opts: SchedulerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    const t = this.now();
    for (const entry of entries) {
      const intervalMs = parseInterval(entry.every);
      if (intervalMs === null) continue; // skip invalid
      this.tasks.push({ entry, intervalMs, nextDue: t + intervalMs });
    }
  }

  /** Number of valid tracked tasks. */
  get size(): number {
    return this.tasks.length;
  }

  /** Run any due tasks, then reschedule them. Returns the ids that ran. */
  async tick(runner: TaskRunner): Promise<string[]> {
    const t = this.now();
    const ran: string[] = [];
    for (const task of this.tasks) {
      if (t >= task.nextDue) {
        ran.push(task.entry.id);
        try {
          await runner(task.entry.prompt);
        } catch {
          /* a failing task must not stop the scheduler */
        }
        task.nextDue = t + task.intervalMs;
      }
    }
    return ran;
  }
}

/** Run the scheduler in the foreground, ticking every `pollMs`. Resolves when signal aborts. */
export async function runScheduler(
  entries: ScheduleEntry[],
  runner: TaskRunner,
  opts: { pollMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const scheduler = new Scheduler(entries);
  const pollMs = opts.pollMs ?? 15_000;
  while (!opts.signal?.aborted) {
    await scheduler.tick(runner);
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
}
