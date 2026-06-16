/** Tool framework types. Tools are validated with Zod and exposed to providers as JSON Schema. */
import type { z } from 'zod';

export type RiskLevel = 'read' | 'edit' | 'execute' | 'network';

export interface ToolContext {
  /** Working directory for the tool. */
  cwd: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Emit incremental output (e.g. streamed shell logs). */
  emit?: (chunk: string) => void;
}

export interface Tool<I = unknown> {
  name: string;
  description: string;
  /** Zod schema describing and validating the input. */
  schema: z.ZodType<I>;
  /** Optional precomputed JSON Schema (e.g. from MCP); used instead of converting `schema`. */
  rawInputSchema?: Record<string, unknown>;
  /** Default risk level used by the permission engine (Phase 4). */
  risk: RiskLevel;
  /** Execute the tool, returning textual output for the model. */
  run(input: I, ctx: ToolContext): Promise<string>;
}

export interface ToolExecution {
  output: string;
  isError: boolean;
}
