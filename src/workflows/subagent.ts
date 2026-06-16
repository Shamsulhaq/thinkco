/** Subagents: run a nested agent loop for a delegated task and return its final text. */
import { z } from 'zod';
import type { ProviderAdapter } from '../types/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import { AgentLoop } from '../agent/loop.js';
import { RecordingSink } from '../agent/output.js';

export interface SubagentOptions {
  provider: ProviderAdapter;
  model: string;
  tools: ToolRegistry;
  system?: string;
  cwd?: string;
  maxIterations?: number;
  /** Context shared from the parent (recent conversation) to seed the subagent. */
  context?: string;
  /** Cancellation signal. */
  signal?: AbortSignal;
}

export interface SubagentResult {
  text: string;
  toolCalls: number;
}

/** Run a one-shot subagent and return its final answer text. */
export async function runSubagent(task: string, opts: SubagentOptions): Promise<SubagentResult> {
  const base = opts.system ?? 'You are a focused subagent. Complete the delegated task and report concisely.';
  const system = opts.context
    ? `${base}\n\n# Shared context from the parent agent\n${opts.context.slice(0, 8000)}`
    : base;
  const loop = new AgentLoop({
    provider: opts.provider,
    model: opts.model,
    tools: opts.tools,
    system,
    cwd: opts.cwd,
    maxIterations: opts.maxIterations ?? 15,
  });
  const sink = new RecordingSink();
  await loop.run(task, sink, opts.signal);
  return { text: sink.fullText, toolCalls: sink.toolCalls.length };
}

/** Expose subagent delegation as a tool the main agent can call. */
export function spawnSubagentTool(opts: SubagentOptions): Tool<{ task: string }> {
  return {
    name: 'spawn_subagent',
    description: 'Delegate a self-contained subtask to a fresh subagent and get back its result.',
    risk: 'execute',
    schema: z.object({ task: z.string().describe('The subtask to delegate') }),
    run: async (input) => {
      const result = await runSubagent(input.task, opts);
      return result.text || '(subagent produced no output)';
    },
  };
}
