/** SubagentManager: owns sub-agent lifecycle (spawn, track, cancel, status). */
import type { ProviderAdapter } from '../../types/index.js';
import type { ToolRegistry } from '../../tools/registry.js';
import { runSubagent } from '../../workflows/subagent.js';
import type { SubagentEntry } from '../commands/host.js';

export interface SubagentManagerDeps {
  /** Build a provider for the subagent (falls back internally to fake on error). */
  createProvider: () => ProviderAdapter;
  /** The active model id. */
  model: () => string;
  tools: ToolRegistry;
  cwd: string;
  /** Recent parent context to optionally seed the subagent with. */
  recentContext: () => string;
}

export class SubagentManager {
  readonly entries: SubagentEntry[] = [];

  constructor(private readonly deps: SubagentManagerDeps) {}

  /** Spawn a subagent, tracked for lifecycle/status/cancellation. */
  spawn(task: string, opts: { shareContext?: boolean; background?: boolean }): SubagentEntry {
    const provider = this.deps.createProvider();
    const controller = new AbortController();
    const context = opts.shareContext ? this.deps.recentContext() : undefined;
    const id = `S${this.entries.length + 1}`;
    const entry: SubagentEntry = { id, task, status: 'running', controller, promise: Promise.resolve() };
    entry.promise = runSubagent(task, {
      provider,
      model: this.deps.model(),
      tools: this.deps.tools,
      cwd: this.deps.cwd,
      context,
      signal: controller.signal,
    })
      .then((res) => {
        entry.status = controller.signal.aborted ? 'cancelled' : 'done';
        entry.result = res.text;
      })
      .catch((err: unknown) => {
        entry.status = controller.signal.aborted ? 'cancelled' : 'error';
        entry.error = err instanceof Error ? err.message : String(err);
      });
    this.entries.push(entry);
    return entry;
  }
}
