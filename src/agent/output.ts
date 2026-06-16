/** Output sink the headless agent writes to. Frontends (CLI, Telegram) implement this. */
import type { ToolCall, Usage } from '../types/index.js';
import type { ToolExecution } from '../tools/types.js';

export interface AgentSink {
  /** Streamed assistant text delta. */
  text(delta: string): void | Promise<void>;
  /** A tool call is about to run. */
  toolCall(call: ToolCall): void | Promise<void>;
  /** A tool call finished. */
  toolResult(call: ToolCall, result: ToolExecution): void | Promise<void>;
  /** Token usage for a turn. */
  usage(usage: Usage): void | Promise<void>;
  /** Informational notice (non-error). */
  notice(message: string): void | Promise<void>;
  /** Error notice. */
  error(message: string): void | Promise<void>;
}

/** A sink that records everything — useful for tests and headless JSON mode. */
export class RecordingSink implements AgentSink {
  texts: string[] = [];
  toolCalls: ToolCall[] = [];
  results: Array<{ call: ToolCall; result: ToolExecution }> = [];
  usages: Usage[] = [];
  notices: string[] = [];
  errors: string[] = [];

  text(delta: string): void {
    this.texts.push(delta);
  }
  toolCall(call: ToolCall): void {
    this.toolCalls.push(call);
  }
  toolResult(call: ToolCall, result: ToolExecution): void {
    this.results.push({ call, result });
  }
  usage(usage: Usage): void {
    this.usages.push(usage);
  }
  notice(message: string): void {
    this.notices.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }

  get fullText(): string {
    return this.texts.join('');
  }
}
