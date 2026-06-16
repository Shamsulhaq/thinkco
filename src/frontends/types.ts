/** Frontend abstraction: interchangeable transports over the headless agent core. */
import type { AgentSink } from '../agent/output.js';
import type { ToolCall } from '../types/index.js';
import type { Tool } from '../tools/types.js';

/** A request to approve a tool action (Phase 4 fills in details). */
export interface ApprovalRequest {
  call: ToolCall;
  tool: Tool<unknown>;
  risk: string;
  reason?: string;
}

/**
 * A Frontend drives the agent for a particular transport (CLI, Telegram, ...).
 * It supplies user input, renders output via an AgentSink, and surfaces approvals.
 */
export interface Frontend {
  readonly name: string;
  /** Render sink the agent loop writes to. */
  createSink(): AgentSink;
  /** Ask the user to approve a tool action. */
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  /** Run the frontend (e.g. start the REPL or bot). Resolves when finished. */
  start(): Promise<void>;
}

export type FrontendFactory = () => Frontend;

export class FrontendRegistry {
  private readonly factories = new Map<string, FrontendFactory>();

  register(name: string, factory: FrontendFactory): void {
    this.factories.set(name, factory);
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  list(): string[] {
    return [...this.factories.keys()];
  }

  create(name: string): Frontend {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`Unknown frontend "${name}". Available: ${this.list().join(', ')}`);
    return factory();
  }
}
