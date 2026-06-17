/**
 * Headless bridge between a VS Code webview (or any GUI) and the agent loop. This file is part
 * of the core (no `vscode` import), so it is compiled, linted, and tested with the rest of the
 * project; the thin activation glue that imports `vscode` lives in `extensions/vscode/`.
 */
import { AgentLoop } from '../../agent/loop.js';
import type { AgentSink } from '../../agent/output.js';
import type { ProviderAdapter, ToolCall } from '../../types/index.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { Tool, ToolExecution } from '../../tools/types.js';

/** Callbacks a frontend supplies to render a turn's streamed output. */
export interface BridgeHandlers {
  onText(delta: string): void;
  onThinking?(delta: string): void;
  onToolCall?(call: ToolCall): void;
  onToolResult?(call: ToolCall, result: ToolExecution): void;
  onNotice?(message: string): void;
  onError?(message: string): void;
  /** Approve a tool call (e.g. via an in-editor dialog). Defaults to allow. */
  approve?(call: ToolCall, tool: Tool<unknown>): Promise<boolean>;
}

export interface VscodeBridgeOptions {
  provider: ProviderAdapter;
  model: string;
  tools: ToolRegistry;
  cwd?: string;
  system?: string;
}

/** Drives a persistent agent loop for a VS Code session. */
export class VscodeBridge {
  private readonly loop: AgentLoop;
  private current?: BridgeHandlers;

  constructor(opts: VscodeBridgeOptions) {
    this.loop = new AgentLoop({
      provider: opts.provider,
      model: opts.model,
      tools: opts.tools,
      cwd: opts.cwd,
      system: opts.system,
      approve: async (call, tool) => (this.current?.approve ? this.current.approve(call, tool) : true),
    });
  }

  /** Send a user prompt and stream the turn's output to the handlers. */
  async send(prompt: string, handlers: BridgeHandlers): Promise<void> {
    this.current = handlers;
    const sink: AgentSink = {
      text: (d) => handlers.onText(d),
      thinking: (d) => handlers.onThinking?.(d),
      toolCall: (c) => handlers.onToolCall?.(c),
      toolResult: (c, r) => handlers.onToolResult?.(c, r),
      usage: () => {},
      notice: (m) => handlers.onNotice?.(m),
      error: (m) => handlers.onError?.(m),
    };
    try {
      await this.loop.run(prompt, sink);
    } finally {
      this.current = undefined;
    }
  }

  /** The running conversation (for transcript export / restore). */
  get messages() {
    return this.loop.messages;
  }
}
