/** Headless mode: run a single task non-interactively and emit text or JSON. */
import type { Config } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/core/index.js';
import { AgentLoop } from '../agent/loop.js';
import { RecordingSink } from '../agent/output.js';
import { PermissionEngine, FileAuditLog } from '../permissions/index.js';
import { loadMemory } from '../context/memory.js';
import { buildSystemPrompt } from '../agent/prompt.js';

export interface HeadlessOptions {
  config: Config;
  json?: boolean;
  cwd?: string;
  /** Auto-approve policy for non-interactive runs: 'deny' (default) or 'allow'. */
  autoApprove?: 'allow' | 'deny';
  providerRegistry?: ProviderRegistry;
}

export interface HeadlessResult {
  status: 'ok' | 'error';
  provider: string;
  model: string;
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number };
  errors: string[];
}

/** Run one task headless. In non-interactive mode, prompts cannot be shown, so the
 *  permission engine auto-allows or auto-denies based on `autoApprove`. */
export async function runHeadless(task: string, opts: HeadlessOptions): Promise<HeadlessResult> {
  const cwd = opts.cwd ?? process.cwd();
  const registry = opts.providerRegistry ?? new ProviderRegistry();
  let providerName = registry.has(opts.config.defaultProvider) ? opts.config.defaultProvider : 'fake';
  let model = registry.resolveModel(providerName, opts.config);
  let provider;
  try {
    provider = registry.create(providerName, opts.config);
  } catch {
    // Fall back to the offline fake provider (e.g. when no API key is configured).
    providerName = 'fake';
    model = registry.resolveModel('fake', opts.config);
    provider = registry.create('fake', opts.config);
  }

  const tools = new ToolRegistry();
  registerCoreTools(tools);

  const engine = new PermissionEngine({
    rules: opts.config.permissions,
    prompt: async () => opts.autoApprove === 'allow',
    audit: new FileAuditLog(`${cwd}/.thinkco/audit.log`),
    origin: 'headless',
    strictRemote: opts.autoApprove !== 'allow',
  });

  const memory = loadMemory(cwd);
  const loop = new AgentLoop({
    provider,
    model,
    tools,
    system: buildSystemPrompt({ cwd, memory, toolNames: tools.list().map((t) => t.name) }),
    approve: engine.toHook(),
    cwd,
  });

  const sink = new RecordingSink();
  await loop.run(task, sink);

  const usage = sink.usages.reduce(
    (acc, u) => ({ inputTokens: acc.inputTokens + u.inputTokens, outputTokens: acc.outputTokens + u.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );

  return {
    status: sink.errors.length ? 'error' : 'ok',
    provider: providerName,
    model,
    text: sink.fullText,
    toolCalls: sink.toolCalls.map((c) => ({ name: c.name, input: c.input })),
    usage,
    errors: sink.errors,
  };
}

/** Format a headless result for stdout. */
export function formatHeadless(result: HeadlessResult, json: boolean): string {
  return json ? JSON.stringify(result, null, 2) : result.text || '(no output)';
}
