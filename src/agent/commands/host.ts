/**
 * CommandHost: the narrow surface the runtime exposes to its extracted command modules.
 * The runtime builds a host object (capturing `this`) and passes it to each command builder,
 * so command logic lives in focused modules without widening the runtime's encapsulation.
 */
import type { Config } from '../../config/index.js';
import type { ProviderRegistry } from '../../providers/registry.js';
import type { PermissionEngine, PermissionMode } from '../../permissions/index.js';
import type { SkillRegistry } from '../../skills/index.js';
import type { UsageTracker } from '../../util/usage.js';
import type { GitSnap } from '../../workflows/checkpointGit.js';
import type { CommandState } from '../commands.js';

/** Primary agents: build (full tools), plan (read-only analysis), compose (orchestration). */
export type AgentName = 'build' | 'plan' | 'compose';

/** A tracked sub-agent run (for lifecycle/status/cancellation). */
export interface SubagentEntry {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  controller: AbortController;
  promise: Promise<void>;
  result?: string;
  error?: string;
}

/** UI hooks a frontend provides for prompts that need interaction. */
export interface RuntimeUI {
  approve(prompt: import('../../permissions/index.js').ApprovalPrompt): Promise<boolean>;
  select(title: string, items: string[], current: number): Promise<string | null>;
  /** Free-text prompt (e.g. for API keys). Returns null if unsupported/cancelled. */
  input?(prompt: string, opts?: { password?: boolean }): Promise<string | null>;
}

export interface CommandHost {
  readonly state: CommandState;
  readonly config: Config;
  readonly usage: UsageTracker;
  readonly engine: PermissionEngine;
  readonly skills: SkillRegistry;
  readonly providerRegistry: ProviderRegistry;
  readonly availableModels: string[];
  readonly globalConfigDir?: string;
  readonly cwd: string;
  readonly ui: RuntimeUI;

  setMode(mode: PermissionMode): void;
  getMode(): PermissionMode;

  // provider helpers
  knownProviders(): string[];
  isProviderConfigured(id: string): boolean;
  configuredProviders(): string[];
  switchProvider(id: string): Promise<string>;
  finishLogin(): Promise<string>;
  selectModelForProvider(provider: string, opts?: { prompt?: boolean; saveScope?: boolean; title?: string }): Promise<{
    model: string;
    liveCount: number;
    usedFallback: boolean;
    cancelled: boolean;
  }>;
  setSkipPersistOnce(v: boolean): void;

  // agent helpers
  getAgent(): AgentName;
  setAgent(name: AgentName): void;
  getGoal(): string | undefined;
  setGoal(goal: string | undefined): void;
  setComposeSpec(spec: string): void;

  // subagents + undo
  readonly subagents: SubagentEntry[];
  gitSnap(): GitSnap;

  /** Current conversation messages (for transcript export). */
  getMessages(): import('../../types/index.js').Message[];
}
