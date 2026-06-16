/** Tool registry: holds tools, exposes them as provider ToolDefs, executes with validation. */
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDef, ToolCall } from '../types/index.js';
import type { Tool, ToolContext, ToolExecution } from './types.js';
import type { z } from 'zod';

/**
 * Convert a Zod schema to a clean JSON Schema for provider tool definitions.
 * Uses standard JSON Schema (draft-07), where `exclusiveMinimum/Maximum` are numbers — OpenAPI 3.0
 * emits them as booleans, which strict providers (e.g. DeepSeek via OpenAI-compatible APIs) reject.
 * Refs are inlined and `$schema` is stripped for maximum compatibility.
 */
function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  delete json.$schema;
  delete (json as { definitions?: unknown }).definitions;
  return json;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown>>();

  register<I>(tool: Tool<I>): void {
    this.tools.set(tool.name, tool as Tool<unknown>);
  }

  registerAll(tools: Tool<unknown>[]): void {
    tools.forEach((t) => this.register(t));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool<unknown> | undefined {
    return this.tools.get(name);
  }

  list(): Tool<unknown>[] {
    return [...this.tools.values()];
  }

  /** Provider-agnostic tool definitions (JSON Schema input). */
  toToolDefs(): ToolDef[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.rawInputSchema ?? toJsonSchema(t.schema),
    }));
  }

  /** Execute a tool call: validate input, run, capture errors as tool output. */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolExecution> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { output: `Unknown tool: ${call.name}`, isError: true };
    }
    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { output: `Invalid input for ${call.name}: ${issues}`, isError: true };
    }
    try {
      const output = await tool.run(parsed.data, ctx);
      return { output, isError: false };
    } catch (err) {
      return { output: `Tool ${call.name} failed: ${(err as Error).message}`, isError: true };
    }
  }
}
