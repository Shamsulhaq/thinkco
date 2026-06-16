/** Headless agent loop: reason → tool-call → execute → observe → repeat. UI-agnostic. */
import type {
  ContentBlock,
  Message,
  ProviderAdapter,
  ToolCall,
  ToolUseBlock,
} from '../types/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import type { AgentSink } from './output.js';
import { compactConversation } from '../context/budget.js';
import { extractTextToolCalls } from './toolparse.js';
import { withIdleTimeout } from '../util/stream.js';

/** Decision returned by an approval hook. May return a reason for denials. */
export type ApprovalVerdict = boolean | { allow: boolean; reason?: string };
export interface ApprovalHook {
  (call: ToolCall, tool: Tool<unknown>): Promise<ApprovalVerdict>;
}

export interface AgentLoopOptions {
  provider: ProviderAdapter;
  model: string;
  tools: ToolRegistry;
  system?: string;
  cwd?: string;
  maxIterations?: number;
  /** Approval gate for tool calls. Defaults to allow-all. */
  approve?: ApprovalHook;
  maxTokens?: number;
  temperature?: number;
  /** When set, compact the conversation if it exceeds this many estimated tokens. */
  contextBudget?: number;
  /** Optional summarizer for compaction (defaults to heuristic). */
  summarize?: (messages: Message[]) => Promise<string>;
  /** Hook invoked before a tool runs; returning block=true vetoes it. */
  beforeTool?: (call: ToolCall) => Promise<{ block: boolean; reason?: string }>;
  /** Hook invoked after a tool runs. */
  afterTool?: (call: ToolCall, output: string, isError: boolean) => Promise<void>;
  /** Abort a turn if the model stream is idle for this many ms (default 180s). */
  stallTimeoutMs?: number;
  /** When true, rethrow provider errors instead of swallowing (enables failover). */
  rethrowProviderErrors?: boolean;
}

export class AgentLoop {
  readonly messages: Message[] = [];
  private readonly opts: Required<Pick<AgentLoopOptions, 'cwd' | 'maxIterations'>> &
    AgentLoopOptions;

  constructor(opts: AgentLoopOptions) {
    this.opts = {
      ...opts,
      cwd: opts.cwd ?? process.cwd(),
      maxIterations: opts.maxIterations ?? 25,
    };
  }

  /** Seed the loop with prior conversation (e.g. resumed session). */
  setMessages(messages: Message[]): void {
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /** Run one user turn to completion (including any tool-use sub-turns). */
  async run(userInput: string, sink: AgentSink, signal?: AbortSignal): Promise<void> {
    this.messages.push({ role: 'user', content: [{ type: 'text', text: userInput }] });

    const toolDefs = this.opts.tools.toToolDefs();
    let executedTool = false;

    for (let iter = 0; iter < this.opts.maxIterations; iter++) {
      if (signal?.aborted) {
        await sink.notice('Interrupted.');
        return;
      }

      if (this.opts.contextBudget) {
        const { messages, compacted } = await compactConversation(this.messages, {
          maxTokens: this.opts.contextBudget,
          summarize: this.opts.summarize,
        });
        if (compacted) {
          this.setMessages(messages);
          await sink.notice('(context compacted)');
        }
      }

      const blocks: ContentBlock[] = [];
      let textBuf = '';
      const toolCalls: ToolCall[] = [];

      try {
        const rawStream = this.opts.provider.chat(this.messages, toolDefs, {
          model: this.opts.model,
          system: this.opts.system,
          maxTokens: this.opts.maxTokens,
          temperature: this.opts.temperature,
          signal,
        });
        const stream = withIdleTimeout(
          rawStream,
          this.opts.stallTimeoutMs ?? 180_000,
          () => new Error(`model stream stalled (no output for ${(this.opts.stallTimeoutMs ?? 180_000) / 1000}s)`),
        );

        for await (const event of stream) {
          switch (event.type) {
            case 'text':
              textBuf += event.text;
              await sink.text(event.text);
              break;
            case 'tool_call':
              toolCalls.push(event.call);
              break;
            case 'usage':
              await sink.usage(event.usage);
            break;
          case 'stop':
            break;
        }
      }
      } catch (err) {
        if (this.opts.rethrowProviderErrors) throw err;
        await sink.error(`Provider error: ${(err as Error).message ?? String(err)}`);
        return;
      }

      // Fallback: some models emit tool calls as JSON in their text instead of using the
      // native tool_calls channel. Recover those so such models still work as agents.
      if (toolCalls.length === 0 && textBuf) {
        const validNames = new Set(toolDefs.map((d) => d.name));
        const recovered = extractTextToolCalls(textBuf, validNames);
        if (recovered.length) {
          for (const call of recovered) toolCalls.push(call);
          await sink.notice(`(parsed ${recovered.length} tool call(s) from the model's text)`);
        }
      }

      if (textBuf) blocks.push({ type: 'text', text: textBuf });
      for (const call of toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input } as ToolUseBlock);
      }
      this.messages.push({ role: 'assistant', content: blocks });

      if (toolCalls.length === 0) {
        if (!textBuf && executedTool) {
          await sink.notice('(done — the model made changes but returned no summary)');
        }
        return; // end of turn
      }

      // Execute tool calls and append results.
      const resultBlocks: ContentBlock[] = [];
      for (const call of toolCalls) {
        await sink.toolCall(call);
        const tool = this.opts.tools.get(call.name);

        if (tool && this.opts.approve) {
          const verdict = await this.opts.approve(call, tool);
          const allowed = typeof verdict === 'boolean' ? verdict : verdict.allow;
          const reason = typeof verdict === 'boolean' ? undefined : verdict.reason;
          if (!allowed) {
            const denied = {
              output: `Permission denied for tool "${call.name}"${reason ? `: ${reason}` : ''}.`,
              isError: true,
            };
            await sink.toolResult(call, denied);
            resultBlocks.push({
              type: 'tool_result',
              toolUseId: call.id,
              content: denied.output,
              isError: true,
            });
            continue;
          }
        }

        if (this.opts.beforeTool) {
          const verdict = await this.opts.beforeTool(call);
          if (verdict.block) {
            const blocked = {
              output: `Blocked by hook${verdict.reason ? `: ${verdict.reason}` : ''}.`,
              isError: true,
            };
            await sink.toolResult(call, blocked);
            resultBlocks.push({
              type: 'tool_result',
              toolUseId: call.id,
              content: blocked.output,
              isError: true,
            });
            continue;
          }
        }

        const result = await this.opts.tools.execute(call, {
          cwd: this.opts.cwd,
          signal,
          emit: (chunk) => void sink.text(chunk),
        });
        executedTool = true;
        await sink.toolResult(call, result);
        if (this.opts.afterTool) await this.opts.afterTool(call, result.output, result.isError);
        resultBlocks.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: result.output,
          isError: result.isError,
        });
      }

      this.messages.push({ role: 'tool', content: resultBlocks });
    }

    await sink.error(`Reached max iterations (${this.opts.maxIterations}).`);
  }
}
