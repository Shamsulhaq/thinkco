/** AgentRuntime: transport-agnostic orchestration shared by the CLI and Ink frontends. */
import { AgentLoop, type ApprovalHook } from './loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { ProviderRegistry } from '../providers/registry.js';
import { SessionStore, newSession, type Session } from './session.js';
import { CommandRegistry, builtinCommands, type CommandState } from './commands.js';
import type { Config } from '../config/index.js';
import { saveProjectConfig, saveGlobalConfig } from '../config/index.js';
import { PermissionEngine, FileAuditLog, type ApprovalPrompt, type PermissionMode } from '../permissions/index.js';
import { loadMemory } from '../context/memory.js';
import { MemoryStore } from '../context/store.js';
import { TaskStore } from './tasks.js';
import { estimateMessagesTokens, estimateTokens, messageText } from '../context/budget.js';
import { buildSystemPrompt } from './prompt.js';
import { expandMentions } from '../context/mentions.js';
import { SkillRegistry, discoverSkills, defaultSkillRoots, registerSkillScripts } from '../skills/index.js';
import { loadCustomCommands } from '../commands/custom.js';
import { extendedCommands } from '../cli/builtins.js';
import { PluginManager } from '../plugins/manager.js';
import { loadClaudePlugin } from '../plugins/claudeAdapter.js';
import { HookRunner, type HookConfig } from '../workflows/hooks.js';
import { UsageTracker } from '../util/usage.js';
import type { AgentSink, TurnSummary } from './output.js';
import { runSubagent } from '../workflows/subagent.js';
import { GitSnap } from '../workflows/checkpointGit.js';
import { z } from 'zod';
import { join, isAbsolute } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { bundledPluginsRoot } from '../plugins/paths.js';
import { buildProviderCommands } from './commands/providers.js';
import type { CommandHost } from './commands/host.js';
import type { PluginSinks, PluginActivationResult } from '../plugins/index.js';

const CONTEXT_WINDOW_TOKENS = 60_000;

interface ActiveTurnStats {
  toolCalls: number;
  toolNames: string[];
  approvals: number;
  inputTokens: number;
  outputTokens: number;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}

/** UI hooks a frontend provides for prompts that need interaction. */
export interface RuntimeUI {
  approve(prompt: ApprovalPrompt): Promise<boolean>;
  select(title: string, items: string[], current: number): Promise<string | null>;
  /** Free-text prompt (e.g. for API keys). Returns null if unsupported/cancelled. */
  input?(prompt: string, opts?: { password?: boolean }): Promise<string | null>;
}

export interface AgentRuntimeOptions {
  config: Config;
  providerRegistry: ProviderRegistry;
  tools: ToolRegistry;
  sessionStore: SessionStore;
  ui: RuntimeUI;
  system?: string;
  resume?: boolean;
  /** Resume a specific session by id (overrides `resume`). */
  resumeId?: string;
  approve?: ApprovalHook;
  auditPath?: string;
  availableModels?: string[];
  origin?: string;
  cwd?: string;
  /** Stricter approvals for remote frontends (never auto-allow non-read via allow-rules). */
  strictRemote?: boolean;
  /** Override the global config dir (for tests); defaults to ~/.config/thinkco. */
  globalConfigDir?: string;
}

/** Primary agents: build (full tools), plan (read-only analysis), compose (orchestration). */
export type AgentName = 'build' | 'plan' | 'compose';

/** A tracked sub-agent run (for lifecycle/status/cancellation). */
interface SubagentEntry {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  controller: AbortController;
  promise: Promise<void>;
  result?: string;
  error?: string;
}

export class AgentRuntime {
  readonly state: CommandState;
  readonly commands = new CommandRegistry();
  readonly skills: SkillRegistry;
  readonly engine: PermissionEngine;
  readonly usage = new UsageTracker();
  /** Active primary agent (build = full tools, plan = read-only, compose = orchestration). */
  agent: AgentName = 'build';
  /** Optional stop condition for /goal; evaluated by a judge model before the agent stops. */
  private goalCondition?: string;
  private composeSpec?: string;
  private turnsSinceCheckpoint = 0;
  private budgetController?: AbortController;
  private budgetWarned = false;
  private budgetStopped = false;
  private gitSnapStore?: GitSnap;
  private readonly subagents: SubagentEntry[] = [];
  session: Session;
  private loopInstance: AgentLoop;
  private readonly hookRunner: HookRunner;
  private readonly cwd: string;
  private readonly pluginManager: PluginManager;
  private skipPersistOnce = false;
  private activeTurn?: ActiveTurnStats;
  private lastTurn?: TurnSummary;

  constructor(private readonly opts: AgentRuntimeOptions) {
    this.cwd = opts.cwd ?? process.cwd();
    builtinCommands().forEach((cmd) => this.commands.register(cmd));
    const provider = opts.config.defaultProvider;
    const model = opts.providerRegistry.resolveModel(provider, opts.config);
    this.state = { provider, model };

    this.skills = new SkillRegistry(discoverSkills(defaultSkillRoots(this.cwd)));
    registerSkillScripts(this.skills.list(), (t) => opts.tools.register(t));

    this.commands.register({
      name: 'skills',
      description: 'List available skills',
      run: () => {
        const list = this.skills.list();
        return {
          handled: true,
          message: list.length ? list.map((s) => `- ${s.name}: ${s.description}`).join('\n') : 'No skills found.',
        };
      },
    });

    for (const cmd of loadCustomCommands(join(this.cwd, '.thinkco', 'commands'))) {
      this.commands.register(cmd);
    }

    const pluginHooks: HookConfig = {};
    this.pluginManager = new PluginManager(join(this.cwd, '.thinkco', 'plugins'));
    this.pluginManager.loadEnabled({
      registerCommand: (cmd) => this.commands.register(cmd),
      addSkill: (s) => {
        this.skills.add(s);
        registerSkillScripts([s], (t) => opts.tools.register(t));
      },
      addHooks: (h) => Object.assign(pluginHooks, h),
    });

    // Bundled default plugins (shipped with thinkco) + opt-in Claude Code plugins from config.
    this.loadClaudePlugins(opts.config);

    this.registerPluginCommand();
    this.registerInfoCommands();
    this.registerSubagentTool();
    this.registerAgentCommands();
    this.registerAgentsStatusCommand();
    this.registerBudgetCommand();
    this.registerUndoCommand();
    this.registerFallbackCommand();
    void import('../util/pricing.js').then((m) => m.loadPricing()).then((p) => this.usage.setPricing(p)).catch(() => {});

    for (const cmd of extendedCommands({
      cwd: this.cwd,
      config: opts.config,
      state: this.state,
      getMessages: () => this.loopInstance.messages,
      setMessages: (m) => this.loopInstance.setMessages(m),
      sessionStore: opts.sessionStore,
      getSession: () => this.session,
      setSession: (s) => {
        this.session = s;
      },
      providerRegistry: opts.providerRegistry,
      tools: opts.tools,
      skills: this.skills,
      getMode: () => this.engine.getMode(),
      select: (title, items, current) => opts.ui.select(title, items, current),
    })) {
      this.commands.register(cmd);
    }

    const mergedHooks: HookConfig = { ...opts.config.hooks, ...pluginHooks };
    this.hookRunner = new HookRunner(mergedHooks, this.cwd);

    this.engine = new PermissionEngine({
      rules: opts.config.permissions,
      prompt: (p) => {
        if (this.activeTurn) this.activeTurn.approvals += 1;
        return opts.ui.approve(p);
      },
      audit: new FileAuditLog(opts.auditPath ?? join(this.cwd, '.thinkco', 'audit.log')),
      origin: opts.origin ?? 'cli',
      mode: opts.config.permissions.defaultMode,
      strictRemote: opts.strictRemote,
      classifier: async (call, assessment) => {
        try {
          const provider2 = opts.providerRegistry.create(this.state.provider, opts.config);
          const { makeProviderClassifier } = await import('../permissions/classifier.js');
          return makeProviderClassifier(provider2, this.state.model)(call, assessment);
        } catch {
          return { allow: false, reason: 'classifier unavailable' };
        }
      },
    });
    for (const cmd of buildProviderCommands(this.commandHost())) {
      this.commands.register(cmd);
    }

    const resumed = opts.resumeId
      ? opts.sessionStore.load(opts.resumeId)
      : opts.resume
        ? opts.sessionStore.latest()
        : undefined;
    this.session = resumed ?? newSession(provider, model);
    this.loopInstance = this.buildLoop();
    if (resumed) this.loopInstance.setMessages(resumed.messages);
  }

  get loop(): AgentLoop {
    return this.loopInstance;
  }

  /** The skill registry (includes bundled and plugin-provided skills). */
  get skillRegistry(): SkillRegistry {
    return this.skills;
  }

  getMode(): PermissionMode {
    return this.engine.getMode();
  }

  cycleMode(): PermissionMode {
    return this.engine.cycleMode();
  }

  commandNames(): string[] {
    return this.commands.list().map((cmd) => `/${cmd.name}`).sort();
  }

  latestTurnSummary(): TurnSummary | undefined {
    return this.lastTurn;
  }

  statusSummary(extra: { busy?: boolean; queueLength?: number } = {}): string {
    const lines = [
      `repo:     ${this.cwd}`,
      `provider: ${this.state.provider}`,
      `model:    ${this.state.model}`,
      `mode:     ${this.engine.getMode()}`,
    ];
    if (extra.busy !== undefined) lines.push(`state:    ${extra.busy ? 'busy' : 'idle'}${extra.queueLength ? ` (${extra.queueLength} queued)` : ''}`);
    if (this.lastTurn) lines.push(`last:     ${this.lastTurn.text}`);
    return lines.join('\n');
  }

  changesSummary(): string {
    const files = this.gitChangedFiles(40);
    if (!files.length) return 'No changed files.';
    return ['Changed files:', ...files.map((f) => `- ${f}`), '', 'Use /undo to revert the last autoCommit snapshot when enabled.'].join('\n');
  }

  private lastTurnDetails(): string {
    const t = this.lastTurn;
    if (!t) return 'No completed turn yet.';
    const tools = t.toolNames.length ? Array.from(new Set(t.toolNames)).join(', ') : 'none';
    const files = t.fileChanges.length ? t.fileChanges.slice(0, 12).join(', ') : 'none';
    return [
      t.text,
      `Provider/model: ${t.provider} · ${t.model}`,
      `Tools: ${t.toolCalls} (${tools})`,
      `Approvals: ${t.approvals}`,
      `Tokens this turn: in ${t.inputTokens} / out ${t.outputTokens}`,
      `Files changed: ${files}`,
    ].join('\n');
  }

  private commandHost(): CommandHost {
    return {
      state: this.state,
      config: this.opts.config,
      usage: this.usage,
      engine: this.engine,
      skills: this.skills,
      providerRegistry: this.opts.providerRegistry,
      availableModels: this.opts.availableModels ?? [],
      globalConfigDir: this.opts.globalConfigDir,
      cwd: this.cwd,
      ui: this.opts.ui,
      setMode: (mode) => this.engine.setMode(mode),
      getMode: () => this.engine.getMode(),
      knownProviders: () => this.knownProviders(),
      isProviderConfigured: (id) => this.isProviderConfigured(id),
      configuredProviders: () => this.configuredProviders(),
      switchProvider: (id) => this.switchProvider(id),
      finishLogin: () => this.finishLogin(),
      providerStatus: () => this.providerStatus(),
      selectModelForProvider: (provider, opts) => this.selectModelForProvider(provider, opts),
      setSkipPersistOnce: (v) => {
        this.skipPersistOnce = v;
      },
      getAgent: () => this.agent,
      setAgent: (name) => this.setAgent(name),
      getGoal: () => this.goalCondition,
      setGoal: (goal) => {
        this.goalCondition = goal;
      },
      setComposeSpec: (spec) => {
        this.composeSpec = spec;
      },
      subagents: this.subagents,
      gitSnap: () => this.gitSnap(),
      getMessages: () => this.loopInstance.messages,
    };
  }

  private registerInfoCommands(): void {
    this.commands.register({
      name: 'usage',
      description: 'Show token usage and estimated cost (live pricing from models.dev)',
      run: async () => {
        try {
          const { loadPricing } = await import('../util/pricing.js');
          this.usage.setPricing(await loadPricing());
        } catch {
          /* offline → token counts only */
        }
        return { handled: true, message: this.usage.format(this.state.model, this.state.provider) };
      },
    });
    this.commands.register({
      name: 'mode',
      description: 'Permission mode: /mode [default|acceptEdits|plan|dontAsk|auto|bypass]',
      run: (ctx) => {
        const valid = ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto', 'bypass'];
        if (ctx.args && valid.includes(ctx.args)) {
          this.engine.setMode(ctx.args as PermissionMode);
          return { handled: true, message: `Permission mode: ${ctx.args}` };
        }
        return {
          handled: true,
          message:
            `Permission mode: ${this.engine.getMode()}\n` +
            `Cycle with Shift+Tab, or /mode <name>. Modes: default, acceptEdits, plan, dontAsk, auto, bypass.`,
        };
      },
    });
    this.commands.register({
      name: 'turn',
      description: 'Show the latest turn details',
      run: () => ({ handled: true, message: this.lastTurnDetails() }),
    });
    this.commands.register({
      name: 'status',
      description: 'Show runtime status: repo, provider/model, mode, and latest turn',
      run: () => ({ handled: true, message: this.statusSummary() }),
    });
    this.commands.register({
      name: 'details',
      description: 'Show the latest turn details',
      run: () => ({ handled: true, message: this.lastTurnDetails() }),
    });
    this.commands.register({
      name: 'changes',
      description: 'Show changed files in the working tree',
      run: () => ({ handled: true, message: this.changesSummary() }),
    });
    this.commands.register({
      name: 'trust',
      description: 'Trust this folder: auto-approve basic read/write/edit/search/shell actions',
      run: () => {
        const basics = ['read', 'list', 'glob', 'grep', 'write', 'edit', 'shell', 'git'];
        const allow = this.opts.config.permissions.allow;
        for (const t of basics) if (!allow.includes(t)) allow.push(t);
        saveProjectConfig({ permissions: this.opts.config.permissions });
        return {
          handled: true,
          message: 'Folder trusted: basic actions auto-approved. Destructive/secret actions still ask.',
        };
      },
    });
  }

  private pluginSinks(): PluginSinks {
    return {
      registerCommand: (cmd) => {
        this.commands.register(cmd);
        this.refreshKnownCommands?.();
      },
      addSkill: (s) => {
        this.skills.add(s);
        registerSkillScripts([s], (t) => this.opts.tools.register(t));
      },
      addHooks: (h) => this.hookRunner.addHooks(h),
    };
  }

  private pluginActivationMessage(result: PluginActivationResult, action = 'Installed and loaded'): string {
    const parts = [
      `${action} "${result.name}".`,
      result.summary.commands.length ? `Commands: ${result.summary.commands.map((c) => `/${c}`).join(', ')}.` : '',
      result.summary.skills.length ? `Skills: ${result.summary.skills.join(', ')}.` : '',
      result.summary.hooks.length ? `Hooks: ${result.summary.hooks.join(', ')}.` : '',
      result.restartRequired.includes('mcpServers')
        ? `Restart required for MCP servers: ${result.summary.mcpServers.join(', ')}.`
        : '',
    ].filter(Boolean);
    return parts.join(' ');
  }

  /** Optional frontend hook used when runtime command/plugin registrations change. */
  refreshKnownCommands?: () => void;

  installPlugin(source: string): string {
    return this.pluginActivationMessage(this.pluginManager.installAndActivate(source, this.pluginSinks()));
  }

  enablePlugin(name: string): string {
    return this.pluginActivationMessage(this.pluginManager.activate(name, this.pluginSinks()), 'Enabled and loaded');
  }

  disablePlugin(name: string): string {
    this.pluginManager.disable(name);
    return `Disabled "${name}". Already-loaded commands and skills remain available until restart.`;
  }

  removePlugin(name: string): string {
    this.pluginManager.remove(name);
    return `Removed "${name}". Restart clears any commands or skills already loaded from this plugin.`;
  }

  pluginDoctor(name: string): string {
    const d = this.pluginManager.diagnose(name);
    const lines = [
      `Plugin: ${d.name}`,
      `installed: ${d.installed ? 'yes' : 'no'}`,
      `enabled:   ${d.enabled ? 'yes' : 'no'}`,
      `manifest:  ${d.manifestValid ? 'ok' : 'error'}`,
    ];
    if (d.commands.length) lines.push(`commands:  ${d.commands.map((c) => `/${c}`).join(', ')}`);
    if (d.skills.length) lines.push(`skills:    ${d.skills.join(', ')}`);
    if (d.hooks.length) lines.push(`hooks:     ${d.hooks.join(', ')}`);
    if (d.mcpServers.length) lines.push(`mcp:       ${d.mcpServers.join(', ')} (restart required)`);
    if (d.error) lines.push(`error:     ${d.error}`);
    if (!d.installed) lines.push(`fix:       /plugin install ${name}`);
    else if (!d.enabled) lines.push(`fix:       /plugin enable ${name}`);
    else if (d.restartRequired.length) lines.push('fix:       restart thinkco to load MCP servers.');
    else lines.push('status:    installed and hot-loadable.');
    return lines.join('\n');
  }

  listPlugins(): Array<{ name: string; enabled: boolean }> {
    return this.pluginManager.list().map((name) => ({ name, enabled: this.pluginManager.isEnabled(name) }));
  }

  private registerPluginCommand(): void {
    this.commands.register({
      name: 'plugin',
      description: 'Manage plugins: /plugin [search <q>|install <src>|enable <n>|disable <n>|remove <n>|doctor <n>]',
      run: async (ctx) => {
        const [sub, ...rest] = ctx.args.split(/\s+/).filter(Boolean);
        const arg = rest.join(' ');
        try {
          if (sub === 'search') {
            const { searchRegistry } = await import('../plugins/registry.js');
            const hits = searchRegistry(arg);
            return {
              handled: true,
              message: hits.length
                ? hits.map((e) => `- ${e.name}: ${e.description}\n  ${e.url}`).join('\n')
                : 'No matching plugins in the registry.',
            };
          }
          if (sub === 'install' && arg) {
            return { handled: true, message: this.installPlugin(arg) };
          }
          if (sub === 'doctor' && arg) {
            return { handled: true, message: this.pluginDoctor(arg) };
          }
          if (sub === 'enable' && arg) {
            return { handled: true, message: this.enablePlugin(arg) };
          }
          if (sub === 'disable' && arg) {
            return { handled: true, message: this.disablePlugin(arg) };
          }
          if (sub === 'remove' && arg) {
            return { handled: true, message: this.removePlugin(arg) };
          }
        } catch (err) {
          return { handled: true, message: `Plugin error: ${(err as Error).message}` };
        }
        const installed = this.pluginManager.list();
        return {
          handled: true,
          message:
            (installed.length
              ? installed.map((n) => `- ${n}${this.pluginManager.isEnabled(n) ? ' [enabled, loaded]' : ' [installed, disabled]'}`).join('\n')
              : 'No plugins installed.') + '\nUse: /plugin install <git-url|path> · enable/disable/remove/doctor <name>',
        };
      },
    });
  }

  /** Resolve the directory of plugins bundled with thinkco. */
  private bundledPluginsDir(): string {
    return bundledPluginsRoot();
  }

  /** Load a Claude Code-format plugin directory: agents → skills, commands → commands. */
  private applyClaudePlugin(dir: string): void {
    const { skills, commands } = loadClaudePlugin(dir);
    for (const skill of skills) {
      this.skills.add(skill);
      registerSkillScripts([skill], (t) => this.opts.tools.register(t));
    }
    for (const cmd of commands) this.commands.register(cmd);
  }

  /**
   * Load bundled default plugins (Claude Code-format dirs under thinkco's `plugins/`) plus any
   * opt-in plugins listed in `config.claudePlugins`. Bundled defaults boost the coding workflow;
   * everything else is installed by choice.
   */
  private loadClaudePlugins(config: Config): void {
    const bundledDir = this.bundledPluginsDir();
    if (existsSync(bundledDir)) {
      for (const entry of readdirSync(bundledDir)) {
        const dir = join(bundledDir, entry);
        try {
          // Only Claude Code-format bundles (those with a `.claude/` dir) auto-load by default.
          if (statSync(dir).isDirectory() && existsSync(join(dir, '.claude'))) {
            this.applyClaudePlugin(dir);
          }
        } catch {
          // skip unreadable bundle
        }
      }
    }
    for (const p of config.claudePlugins ?? []) {
      const dir = isAbsolute(p) ? p : join(this.cwd, p);
      try {
        if (existsSync(dir)) this.applyClaudePlugin(dir);
      } catch {
        // skip bad path
      }
    }
  }

  /** Register a `subagent` tool that delegates a subtask to a fresh agent loop. */
  private registerSubagentTool(): void {
    const tool: import('../tools/types.js').Tool<{ task: string; share_context?: boolean; background?: boolean }> = {
      name: 'subagent',
      description:
        'Delegate a subtask to a sub-agent. Options: share_context (seed it with the parent ' +
        'conversation) and background (run async, returns an id; check with /agents). Without ' +
        'background it runs to completion and returns the result.',
      risk: 'execute',
      schema: z.object({
        task: z.string().describe('The subtask to delegate'),
        share_context: z.boolean().optional().describe('Seed the subagent with recent parent context'),
        background: z.boolean().optional().describe('Run in the background and return an id immediately'),
      }),
      run: async (input) => {
        const entry = this.spawnSubagent(input.task, {
          shareContext: input.share_context,
          background: input.background,
        });
        if (input.background) {
          return `Started background subagent ${entry.id}: "${input.task.slice(0, 60)}". Check status with /agents (cancel with /agents cancel ${entry.id}).`;
        }
        await entry.promise;
        if (entry.status === 'cancelled') return `Subagent ${entry.id} was cancelled.`;
        if (entry.status === 'error') return `Subagent ${entry.id} failed: ${entry.error}`;
        return entry.result || '(subagent produced no output)';
      },
    };
    this.opts.tools.register(tool);
  }

  /** Spawn a subagent, tracked for lifecycle/status/cancellation. */
  private spawnSubagent(task: string, opts: { shareContext?: boolean; background?: boolean }): SubagentEntry {
    let provider;
    try {
      provider = this.opts.providerRegistry.create(this.state.provider, this.opts.config);
    } catch {
      provider = this.opts.providerRegistry.create('fake', this.opts.config);
    }
    const controller = new AbortController();
    const context = opts.shareContext
      ? this.loopInstance.messages.slice(-8).map((m) => `${m.role}: ${messageText(m).slice(0, 600)}`).join('\n')
      : undefined;
    const id = `S${this.subagents.length + 1}`;
    const entry: SubagentEntry = { id, task, status: 'running', controller, promise: Promise.resolve() };
    entry.promise = runSubagent(task, {
      provider,
      model: this.state.model,
      tools: this.opts.tools,
      cwd: this.cwd,
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
    this.subagents.push(entry);
    return entry;
  }

  private registerAgentsStatusCommand(): void {
    this.commands.register({
      name: 'agents',
      description: 'List sub-agents and their status: /agents | /agents cancel <id>',
      run: (ctx) => {
        const [sub, id] = ctx.args.trim().split(/\s+/);
        if (sub === 'cancel' && id) {
          const e = this.subagents.find((s) => s.id === id);
          if (!e) return { handled: true, message: `No subagent ${id}.` };
          if (e.status === 'running') {
            e.controller.abort();
            return { handled: true, message: `Cancelling ${id}…` };
          }
          return { handled: true, message: `${id} is already ${e.status}.` };
        }
        if (sub === 'result' && id) {
          const e = this.subagents.find((s) => s.id === id);
          if (!e) return { handled: true, message: `No subagent ${id}.` };
          if (e.status === 'running') return { handled: true, message: `${id} is still running.` };
          if (e.status === 'error') return { handled: true, message: `${id} failed: ${e.error}` };
          if (e.status === 'cancelled') return { handled: true, message: `${id} was cancelled.` };
          return { handled: true, message: e.result || `(${id} produced no output)` };
        }
        if (this.subagents.length === 0) return { handled: true, message: 'No sub-agents have run this session.' };
        return {
          handled: true,
          message:
            this.subagents.map((e) => `${e.id} [${e.status}] ${e.task.slice(0, 60)}`).join('\n') +
            '\n\n/agents result <id> · /agents cancel <id>',
        };
      },
    });
  }

  /** True if a provider has usable credentials (config key/baseUrl, local server, or env key). */
  private isProviderConfigured(id: string): boolean {
    const pc = this.opts.config.providers[id] ?? {};
    if (pc.apiKey || pc.baseUrl) return true;
    if (id === 'ollama' || id === 'lmstudio' || id === 'fake') return true;
    return Boolean(process.env[`${id.toUpperCase()}_API_KEY`]);
  }

  /** All known providers: built-in factories union providers declared in config. */
  private knownProviders(): string[] {
    const set = new Set<string>(this.opts.providerRegistry.list());
    for (const id of Object.keys(this.opts.config.providers)) set.add(id);
    set.delete('fake');
    return [...set].sort();
  }

  /** Providers that have usable credentials (key/baseUrl/local/env), plus the current one. */
  private configuredProviders(): string[] {
    const ready = this.knownProviders().filter((id) => this.isProviderConfigured(id));
    if (!ready.includes(this.state.provider)) ready.unshift(this.state.provider);
    return ready;
  }

  private async switchProvider(id: string): Promise<string> {
    this.state.provider = id;
    const result = await this.selectModelForProvider(id, {
      prompt: true,
      saveScope: true,
      title: `Select a model for ${id}`,
    });
    this.loopInstance = this.buildLoop();
    const warning = result.usedFallback ? ' Live models were unavailable; using the registry default.' : '';
    return result.cancelled
      ? `Switched to ${id} · ${this.state.model}.${warning}`
      : `Switched to ${id} · ${result.model}.${warning}`;
  }

  /** After a successful login: test the connection by fetching models, let the user pick one, rebuild. */
  private async finishLogin(): Promise<string> {
    const result = await this.selectModelForProvider(this.state.provider, {
      prompt: true,
      saveScope: true,
      title: `Select a model for ${this.state.provider}`,
    });
    this.loopInstance = this.buildLoop();
    return result.liveCount
      ? `✓ Connected to ${this.state.provider} — ${result.liveCount} model(s) available, using "${this.state.model}".`
      : `⚠ Saved ${this.state.provider}, but could not fetch models (check the API key, base URL, or that the server is running). Use /models to retry.`;
  }

  private async discoverModels(provider: string): Promise<{ models: string[]; liveCount: number; usedFallback: boolean }> {
    let models: string[] = [];
    try {
      const { listModels } = await import('../providers/local.js');
      models = await listModels(provider, this.opts.config);
    } catch {
      models = [];
    }
    const liveCount = models.length;
    if (!models.length && provider === this.state.provider) models = this.opts.availableModels ?? [];
    if (!models.length) models = [this.opts.providerRegistry.resolveModel(provider, this.opts.config)].filter(Boolean);
    return { models, liveCount, usedFallback: liveCount === 0 };
  }

  private async modelLabels(provider: string, models: string[]): Promise<string[]> {
    try {
      const { loadPricing, priceLabel } = await import('../util/pricing.js');
      const pricing = await loadPricing();
      return models.map((m) => {
        const info = priceLabel(pricing, m, provider);
        return info ? `${m}  —  ${info}` : m;
      });
    } catch {
      return models;
    }
  }

  private async selectModelForProvider(
    provider: string,
    opts: { prompt?: boolean; saveScope?: boolean; title?: string } = {},
  ): Promise<{ model: string; liveCount: number; usedFallback: boolean; cancelled: boolean }> {
    const { models, liveCount, usedFallback } = await this.discoverModels(provider);
    const fallback = this.opts.providerRegistry.resolveModel(provider, this.opts.config);
    let picked = provider === this.state.provider ? this.state.model : fallback;
    if (!picked) picked = models[0] ?? fallback;
    let cancelled = false;
    if (opts.prompt !== false && models.length > 0) {
      const labels = await this.modelLabels(provider, models.slice(0, 100));
      const modelWindow = models.slice(0, 100);
      const current = Math.max(0, modelWindow.indexOf(picked));
      const pickedLabel = await this.opts.ui.select(opts.title ?? `Select model (${provider})`, labels, current);
      if (pickedLabel) picked = modelWindow[labels.indexOf(pickedLabel)] ?? pickedLabel;
      else cancelled = true;
    }
    this.state.provider = provider;
    this.state.model = picked;
    if (opts.saveScope !== false) {
      const scope = await this.opts.ui.select(
        `Save "${picked}" as default for…`,
        ['This project', 'Global (all projects)', 'This session only'],
        0,
      );
      if (scope?.startsWith('Global')) {
        saveGlobalConfig({ defaultProvider: provider, defaultModel: picked }, this.opts.globalConfigDir);
      }
      this.skipPersistOnce = scope === 'This session only';
    }
    return { model: picked, liveCount, usedFallback, cancelled };
  }

  /** Build the agent-profile system-prompt note for the active primary agent. */
  /** Switch the active primary agent, aligning the permission mode and rebuilding the loop. */
  setAgent(name: AgentName): void {
    this.agent = name;
    this.engine.setMode(name === 'plan' ? 'plan' : 'default');
    this.applyRouting(name);
    const prev = [...this.loopInstance.messages];
    this.loopInstance = this.buildLoop();
    this.loopInstance.setMessages(prev);
  }

  /** Cycle build → plan → compose → build (bound to Tab in the TUI). Returns the new agent. */
  cycleAgent(): AgentName {
    const order: AgentName[] = ['build', 'plan', 'compose'];
    const next = order[(order.indexOf(this.agent) + 1) % order.length]!;
    this.setAgent(next);
    return next;
  }

  private registerAgentCommands(): void {
    this.commands.register({
      name: 'agent',
      description: 'Switch primary agent: /agent [build|plan|compose]',
      run: (ctx) => {
        const choice = ctx.args.trim() as AgentName;
        if (['build', 'plan', 'compose'].includes(choice)) {
          this.setAgent(choice);
          return { handled: true, message: `Agent: ${choice}` };
        }
        return {
          handled: true,
          message:
            `Current agent: ${this.agent}\n` +
            '  build    full tool permissions for development\n' +
            '  plan     read-only analysis & solution design\n' +
            '  compose  specs-driven orchestration (plan→implement→review→test→verify)',
        };
      },
    });

    this.commands.register({
      name: 'goal',
      description: 'Set a stop condition judged by an independent model: /goal <condition> | clear',
      run: (ctx) => {
        const arg = ctx.args.trim();
        if (!arg) {
          return { handled: true, message: this.goalCondition ? `Goal: ${this.goalCondition}` : 'No goal set. Use /goal <condition>.' };
        }
        if (arg === 'clear') {
          this.goalCondition = undefined;
          return { handled: true, message: 'Goal cleared.' };
        }
        this.goalCondition = arg;
        return { handled: true, message: `Goal set: ${arg}\nA judge model will verify it before the agent stops.` };
      },
    });

    this.commands.register({
      name: 'compose',
      description: 'Specs-driven orchestration: /compose <spec> (runs plan→implement→review→test→verify)',
      run: (ctx) => {
        this.setAgent('compose');
        const spec = ctx.args.trim();
        if (!spec) {
          return { handled: true, message: 'Switched to compose agent. Run /compose <spec> to orchestrate the full lifecycle.' };
        }
        this.composeSpec = spec; // handled by handleInput → runCompose (multi-phase)
        return { handled: true, message: `Composing: ${spec}` };
      },
    });
  }

  private agentProfilePrompt(): string {
    switch (this.agent) {
      case 'plan':
        return 'AGENT: plan. Read-only analysis mode — explore the code and design a solution, but do NOT modify files or run state-changing commands. Produce a clear plan.';
      case 'compose':
        return (
          'AGENT: compose. Specs-driven orchestration. Drive the lifecycle: clarify the spec → plan ' +
          '(task tree via the `task` tool) → implement → review → test (TDD where sensible) → verify → ' +
          'summarize. Delegate focused subtasks with the `subagent` tool and keep the task tree updated.'
        );
      default:
        return '';
    }
  }

  /** Token-budgeted, importance-ranked session context for the prompt. */
  private sessionContextBlock(): string {
    const mem = new MemoryStore(this.cwd).snapshot();
    const tasks = new TaskStore(this.cwd).openSummary();
    // Higher weight = injected first; each truncated to its own cap, all within a token budget.
    const sections: Array<{ title: string; body: string; cap: number; weight: number }> = [
      { title: 'Open tasks', body: tasks, cap: 2500, weight: 4 },
      { title: 'Last checkpoint', body: mem.checkpoint, cap: 4000, weight: 3 },
      { title: 'Project memory (MEMORY.md)', body: mem.memory, cap: 6000, weight: 2 },
      { title: 'Scratch notes', body: mem.notes, cap: 1500, weight: 1 },
    ];
    const budgetTokens = 4000; // cap total injected session context (~16k chars)
    let used = 0;
    const out: string[] = [];
    for (const s of sections.filter((x) => x.body).sort((a, b) => b.weight - a.weight)) {
      const text = s.body.slice(0, s.cap);
      const cost = estimateTokens(text);
      if (used + cost > budgetTokens) continue;
      used += cost;
      out.push(`## ${s.title}\n${text}`);
    }
    return out.length ? `# Session memory (auto-injected, budgeted)\n${out.join('\n\n')}` : '';
  }

  /** Checkpoint-writer: write an LLM-summarized state snapshot to .thinkco/memory/checkpoint.md. */
  private async writeCheckpoint(): Promise<void> {
    const messages = this.loopInstance.messages;
    const recent = messages.slice(-14);
    const transcript = recent
      .map((m) => `${m.role}: ${messageText(m).replace(/\s+/g, ' ').slice(0, 500)}`)
      .join('\n');
    const tasks = new TaskStore(this.cwd).openSummary();

    // Checkpoint-writer: ask the model for a structured state snapshot (decisions, files, next steps).
    let summary = '';
    try {
      const provider = this.opts.providerRegistry.create(this.state.provider, this.opts.config);
      const prompt = [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text:
                `Write a concise CHECKPOINT of this coding session so it can be resumed later. ` +
                `Use these sections: Intent, Key decisions, Files changed, Open tasks, Next steps.\n\n` +
                `Goal: ${this.goalCondition ?? '(none)'}\nOpen tasks:\n${tasks || '(none)'}\n\nTranscript:\n${transcript}`,
            },
          ],
        },
      ];
      for await (const evt of provider.chat(prompt, [], { model: this.state.model })) {
        if (evt.type === 'text') summary += evt.text;
      }
    } catch {
      /* fall back to the raw transcript below */
    }

    const body = [
      `# Checkpoint — ${new Date().toISOString()}`,
      `Provider/model: ${this.state.provider} · ${this.state.model} · agent: ${this.agent}`,
      this.goalCondition ? `Goal: ${this.goalCondition}` : '',
      tasks ? `\n## Open tasks\n${tasks}` : '',
      summary.trim() ? `\n${summary.trim()}` : `\n## Recent activity\n${transcript}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      new MemoryStore(this.cwd).setCheckpoint(body);
    } catch {
      /* checkpoint best-effort */
    }
  }

  /**
   * After a turn: checkpoint periodically, and if the context is near budget, reconstruct it from
   * the freshly-written checkpoint + memory + open tasks (carried in the system prompt) plus the
   * most recent messages, so the agent can keep working without blowing the window.
   */
  private async checkpointAndReconstruct(): Promise<void> {
    this.turnsSinceCheckpoint += 1;
    const tokens = estimateMessagesTokens(this.loopInstance.messages);
    const overBudget = tokens > 48_000; // ~80% of the 60k loop budget
    if (overBudget || this.turnsSinceCheckpoint >= 3) {
      await this.writeCheckpoint();
      this.turnsSinceCheckpoint = 0;
    }
    if (overBudget) {
      const recent = this.loopInstance.messages.slice(-8);
      this.loopInstance = this.buildLoop(); // rebuilt system prompt now carries the new checkpoint
      this.loopInstance.setMessages(recent);
    }
  }

  /** Wrap a sink so token usage is also recorded into the runtime's UsageTracker (/usage). */
  private withUsageTracking(sink: AgentSink): AgentSink {
    return {
      text: (d) => sink.text(d),
      thinking: (d) => sink.thinking?.(d),
      toolCall: (c) => {
        if (this.activeTurn) {
          this.activeTurn.toolCalls += 1;
          this.activeTurn.toolNames.push(c.name);
        }
        return sink.toolCall(c);
      },
      toolResult: (c, r) => sink.toolResult(c, r),
      usage: (u) => {
        if (this.activeTurn) {
          this.activeTurn.inputTokens += u.inputTokens;
          this.activeTurn.outputTokens += u.outputTokens;
        }
        this.usage.add(u);
        this.checkBudget(sink);
        return sink.usage(u);
      },
      notice: (m) => sink.notice(m),
      error: (m) => sink.error(m),
      turnSummary: (s) => sink.turnSummary?.(s),
    };
  }

  private buildLoop(): AgentLoop {
    let provider;
    try {
      provider = this.opts.providerRegistry.create(this.state.provider, this.opts.config);
    } catch {
      provider = this.opts.providerRegistry.create('fake', this.opts.config);
      this.state.provider = 'fake';
    }
    const memory = loadMemory(this.cwd);
    const base =
      this.opts.system ??
      buildSystemPrompt({
        cwd: this.cwd,
        memory,
        skillsCatalog: this.skills.catalog() || undefined,
        toolNames: this.opts.tools.list().map((t) => t.name),
        commands: this.commands.list().map((c) => ({ name: c.name, description: c.description })),
      });
    const system = [base, this.agentProfilePrompt(), this.sessionContextBlock()].filter(Boolean).join('\n\n');
    return new AgentLoop({
      provider,
      model: this.state.model,
      tools: this.opts.tools,
      system,
      cwd: this.cwd,
      approve: this.opts.approve ?? this.engine.toHook(),
      contextBudget: CONTEXT_WINDOW_TOKENS,
      rethrowProviderErrors: this.opts.config.fallback.length > 0,
      beforeTool: this.hookRunner.beforeToolHook(),
      afterTool: this.hookRunner.afterToolHook(),
    });
  }

  /** Handle one line of user input. Returns {exit} when the session should end. */
  async handleInput(line: string, sink: AgentSink, signal?: AbortSignal): Promise<{ exit: boolean }> {
    const input = line.trim();
    if (!input) return { exit: false };
    const startedAt = Date.now();
    const turnStats = this.emptyTurnStats();
    this.activeTurn = turnStats;
    const tracked = this.withUsageTracking(sink);
    const turnSignal = this.beginBudgetTurn(signal);

    if (CommandRegistry.isCommand(input)) {
      const before = { provider: this.state.provider, model: this.state.model };
      const result = await this.commands.dispatch(input, this.state);
      if (result.message) await sink.notice(result.message);
      if (this.state.exit) {
        this.activeTurn = undefined;
        return { exit: true };
      }
      if (this.state.clear) {
        this.state.clear = false;
        this.loopInstance.setMessages([]);
        this.session.messages = [];
      }
      if (this.state.provider !== before.provider || this.state.model !== before.model) {
        const prev = [...this.loopInstance.messages];
        this.loopInstance = this.buildLoop();
        this.loopInstance.setMessages(prev);
        if (this.skipPersistOnce) this.skipPersistOnce = false;
        else saveProjectConfig({ defaultProvider: this.state.provider, defaultModel: this.state.model });
      }
      if (result.prompt) {
        await this.loopInstance.run(result.prompt, tracked, turnSignal);
        this.persist();
        await this.emitCompletionSummary(sink, startedAt, turnStats);
      }
      if (this.composeSpec) {
        const spec = this.composeSpec;
        this.composeSpec = undefined;
        await this.runCompose(spec, tracked, turnSignal);
        this.persist();
        await this.emitCompletionSummary(sink, startedAt, turnStats);
      }
      this.activeTurn = undefined;
      return { exit: false };
    }

    const { text: expanded, files } = expandMentions(input, this.cwd);
    if (files.length) await sink.notice(`(included ${files.length} file(s): ${files.join(', ')})`);
    const activated = this.skills.activate(input);
    let turnInput = expanded;
    if (activated.length) {
      await sink.notice(`(activated skill(s): ${activated.map((s) => s.name).join(', ')})`);
      const bodies = activated.map((s) => `# Skill: ${s.name}\n${s.body}`).join('\n\n');
      turnInput = `${bodies}\n\n---\n${expanded}`;
    }
    const allowedBySkills = this.skills.activeAllowedTools(input);
    if (allowedBySkills.length) this.engine.setTransientAllow(allowedBySkills);

    // Make the active permission mode legible to the model (and the user).
    const mode = this.engine.getMode();
    if (mode === 'plan') {
      await sink.notice('(plan mode: read-only — press Shift+Tab or run /mode default to allow edits)');
      turnInput =
        `[PLAN MODE is active: investigate and propose a concrete plan ONLY. ` +
        `Do NOT call edit/write/shell/git to modify anything — those calls are blocked. ` +
        `End by telling the user to press Shift+Tab or run "/mode default" to apply the changes.]\n\n` +
        turnInput;
    }

    if (this.opts.config.autoCommit) this.gitSnap().snapshot();
    try {
      await this.runTurnWithFailover(turnInput, tracked, turnSignal);
      await this.checkpointAndReconstruct();
      // Goal stop-condition: an independent judge decides whether we may actually stop.
      let iterations = 0;
      while (this.goalCondition && iterations < 6 && !turnSignal.aborted) {
        const verdict = await this.judgeGoal();
        if (verdict.satisfied) {
          await sink.notice(`✓ Goal satisfied: ${verdict.reason}`);
          break;
        }
        iterations += 1;
        await sink.notice(`↻ Goal not met yet (${verdict.reason}). Continuing (${iterations}/6)…`);
        await this.loopInstance.run(
          `Keep working toward this goal — it is NOT yet satisfied.\nGoal: ${this.goalCondition}\nJudge feedback: ${verdict.reason}`,
          tracked,
          turnSignal,
        );
        await this.checkpointAndReconstruct();
      }
    } finally {
      this.engine.clearTransientAllow();
    }
    this.persist();
    await this.emitCompletionSummary(sink, startedAt, turnStats);
    this.activeTurn = undefined;
    return { exit: false };
  }

  private gitChangedFiles(limit = 20): string[] {
    try {
      const out = execSync('git status --porcelain', { cwd: this.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const files = out
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const raw = line.slice(3);
          const renamed = raw.includes(' -> ') ? raw.split(' -> ').at(-1)! : raw;
          return renamed.replace(/^"|"$/g, '');
        });
      return files.slice(0, limit);
    } catch {
      return [];
    }
  }

  private providerStatus(): string {
    const configured = this.configuredProviders();
    const fallback = this.opts.config.fallback.length
      ? this.opts.config.fallback.map((f) => `${f.provider}${f.model ? ':' + f.model : ''}`).join(' → ')
      : '(none)';
    return [
      `Provider: ${this.state.provider}`,
      `Model: ${this.state.model}`,
      `Configured providers: ${configured.join(', ') || '(none)'}`,
      `Fallback chain: ${fallback}`,
      `Use /provider <name> to switch · /models refresh to fetch models again.`,
    ].join('\n');
  }

  private completionSummary(startedAt: number, stats: ActiveTurnStats = this.emptyTurnStats()): TurnSummary {
    const elapsed = Date.now() - startedAt;
    const used = estimateMessagesTokens(this.loopInstance.messages);
    const pct = Math.min(100, Math.round((used / CONTEXT_WINDOW_TOKENS) * 100));
    const text = `Worked for ${formatDuration(elapsed)} · Context window ${pct}% used (${formatTokenCount(used)}/${formatTokenCount(CONTEXT_WINDOW_TOKENS)} tokens)`;
    return {
      elapsedMs: elapsed,
      elapsed: formatDuration(elapsed),
      contextUsed: used,
      contextLimit: CONTEXT_WINDOW_TOKENS,
      contextPercent: pct,
      provider: this.state.provider,
      model: this.state.model,
      toolCalls: stats.toolCalls,
      toolNames: stats.toolNames,
      approvals: stats.approvals,
      fileChanges: this.gitChangedFiles(20),
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      text,
    };
  }

  private emptyTurnStats(): ActiveTurnStats {
    return { toolCalls: 0, toolNames: [], approvals: 0, inputTokens: 0, outputTokens: 0 };
  }

  private async emitCompletionSummary(sink: AgentSink, startedAt: number, stats: ActiveTurnStats): Promise<void> {
    const summary = this.completionSummary(startedAt, stats);
    this.lastTurn = summary;
    await sink.turnSummary?.(summary);
    await sink.notice(summary.text);
  }

  /**
   * Compose orchestration: drive the spec → plan → implement → review → test → verify lifecycle as
   * sequential phases, each a full agent turn with a checkpoint between phases.
   */
  /** Begin a turn's budget tracking; returns a signal that also aborts when the cost cap is hit. */
  private beginBudgetTurn(signal?: AbortSignal): AbortSignal {
    this.budgetWarned = false;
    this.budgetStopped = false;
    const ac = new AbortController();
    this.budgetController = ac;
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener('abort', () => ac.abort(), { once: true });
    }
    return ac.signal;
  }

  /** Warn at 80% and hard-stop (abort) at 100% of the configured per-session cost cap. */
  private checkBudget(sink: AgentSink): void {
    const max = this.opts.config.maxCostUSD;
    if (!max) return;
    const cost = this.usage.estimateCost(this.state.model, this.state.provider);
    if (cost >= max && !this.budgetStopped) {
      this.budgetStopped = true;
      void sink.notice(`⛔ Cost budget ${max} reached (~${cost.toFixed(4)}). Stopping this turn.`);
      this.budgetController?.abort();
    } else if (cost >= 0.8 * max && !this.budgetWarned) {
      this.budgetWarned = true;
      void sink.notice(`⚠ ~${cost.toFixed(4)} of ${max} cost budget used.`);
    }
  }

  private registerBudgetCommand(): void {
    this.commands.register({
      name: 'budget',
      description: 'Set or show the per-session cost cap: /budget <usd> | off',
      run: (ctx) => {
        const arg = ctx.args.trim();
        if (arg) this.opts.config.maxCostUSD = arg === 'off' ? 0 : Math.max(0, Number(arg) || 0);
        const spent = this.usage.estimateCost(this.state.model, this.state.provider);
        const cap = this.opts.config.maxCostUSD;
        return { handled: true, message: cap ? `Budget ${cap} · spent ~${spent.toFixed(4)}` : `No budget cap · spent ~${spent.toFixed(4)}` };
      },
    });
  }
  /** Lazily-created git snapshot helper for /undo (autoCommit). */
  private gitSnap(): GitSnap {
    return (this.gitSnapStore ??= new GitSnap(this.cwd));
  }

  private registerUndoCommand(): void {
    this.commands.register({
      name: 'undo',
      description: 'Restore the working tree to the snapshot from before the last turn (needs autoCommit)',
      run: () => {
        if (!this.opts.config.autoCommit) return { handled: true, message: 'Enable "autoCommit" in config to use /undo.' };
        const sha = this.gitSnap().undo();
        return { handled: true, message: sha ? `Reverted working tree to snapshot ${sha.slice(0, 8)}.` : 'No snapshot to undo.' };
      },
    });
  }
  /** Show, set, or clear the provider/model failover chain at runtime (persists globally). */
  private registerFallbackCommand(): void {
    this.commands.register({
      name: 'fallback',
      description: 'Show/set the failover chain: /fallback | /fallback openai:gpt-4o, anthropic | /fallback off',
      run: (ctx) => {
        const arg = ctx.args.trim();
        if (!arg) {
          const chain = this.opts.config.fallback;
          const shown = chain.length
            ? chain.map((f) => `${f.provider}${f.model ? ':' + f.model : ''}`).join(' → ')
            : '(none — configure with: /fallback <provider[:model]>, …)';
          return { handled: true, message: `Active: ${this.state.provider}:${this.state.model}\nFallback chain: ${shown}` };
        }
        if (arg === 'off' || arg === 'clear') {
          this.opts.config.fallback = [];
          saveGlobalConfig({ fallback: [] }, this.opts.globalConfigDir);
          return { handled: true, message: 'Fallback chain cleared.' };
        }
        const entries = arg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const i = s.indexOf(':');
            return i > 0
              ? { provider: s.slice(0, i), model: s.slice(i + 1) }
              : { provider: s };
          });
        this.opts.config.fallback = entries;
        saveGlobalConfig({ fallback: entries }, this.opts.globalConfigDir);
        const shown = entries.map((e) => `${e.provider}${e.model ? ':' + e.model : ''}`).join(' → ');
        return { handled: true, message: `Fallback chain set: ${shown}\nOn a provider error mid-turn, thinkco will switch to the next entry and retry.` };
      },
    });
  }
  /** Apply a model-routing entry ("model" or "provider:model") for an agent/phase key. */
  private applyRouting(key: string): void {
    const route = this.opts.config.modelRouting[key];
    if (!route) return;
    const idx = route.indexOf(':');
    if (idx > 0) {
      this.state.provider = route.slice(0, idx);
      this.state.model = route.slice(idx + 1);
    } else {
      this.state.model = route;
    }
  }
  /** The active provider/model followed by the configured fallback chain (deduped). */
  private failoverChain(): Array<{ provider: string; model: string }> {
    const chain = [{ provider: this.state.provider, model: this.state.model }];
    for (const f of this.opts.config.fallback) {
      const model = f.model ?? this.opts.providerRegistry.resolveModel(f.provider, this.opts.config);
      if (!chain.some((c) => c.provider === f.provider && c.model === model)) chain.push({ provider: f.provider, model });
    }
    return chain;
  }

  /** Run a turn, failing over to the next provider/model in the chain on provider error. */
  private async runTurnWithFailover(input: string, sink: AgentSink, signal?: AbortSignal): Promise<void> {
    const chain = this.failoverChain();
    const snap = [...this.loopInstance.messages];
    let lastErr = '';
    for (let i = 0; i < chain.length; i++) {
      if (i > 0) {
        const next = chain[i]!;
        await sink.notice(
          `⚠ ${this.state.provider}·${this.state.model} failed (${lastErr}); switching to ${next.provider}·${next.model}. ` +
            `Run /provider status or /models refresh to inspect model availability.`,
        );
        this.state.provider = next.provider;
        this.state.model = next.model;
        this.loopInstance = this.buildLoop();
        this.loopInstance.setMessages(snap);
      }
      try {
        await this.loopInstance.run(input, sink, signal);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    await sink.error(`All providers in the fallback chain failed: ${lastErr}`);
  }
  private async runCompose(spec: string, sink: AgentSink, signal?: AbortSignal): Promise<void> {
    const phases: Array<[string, string]> = [
      ['plan', `Restate the spec and assumptions, then create a task tree with the \`task\` tool (subtasks under a top task). Spec:\n${spec}`],
      ['docs', 'Write a `PRD.md` (Product Requirements Document) at the project root capturing the goals, scope, user stories/requirements, constraints, and acceptance criteria derived from the spec. If the work warrants it, also create supporting design docs (e.g. `ARCHITECTURE.md` or `DESIGN.md`). Use the write/edit tools.'],
      ['implement', 'Implement the planned tasks. Use the file/edit/shell tools; mark each task in_progress then done with the `task` tool as you complete it. Delegate self-contained chunks with the `subagent` tool when helpful.'],
      ['review', 'Critically review the changes so far for correctness, security, and clarity. Fix any issues you find.'],
      ['test', 'Add or update tests that meaningfully verify the new behavior, then run them.'],
      ['verify', 'Run the project build and full test suite. Fix failures until everything is green, then give a short final summary of what shipped and what was verified.'],
    ];
    for (const [name, instruction] of phases) {
      if (signal?.aborted) {
        await sink.notice('Compose cancelled.');
        return;
      }
      const phaseRoute = this.opts.config.modelRouting['compose:' + name];
      if (phaseRoute) {
        const snap = [...this.loopInstance.messages];
        this.applyRouting('compose:' + name);
        this.loopInstance = this.buildLoop();
        this.loopInstance.setMessages(snap);
      }
      await sink.notice(`▶ Compose phase: ${name}`);
      await this.runTurnWithFailover(`[COMPOSE · ${name.toUpperCase()} phase] ${instruction}`, sink, signal);
      if (this.loopInstance.lastError) {
        await sink.error(
          `✗ Compose aborted in the "${name}" phase: ${this.loopInstance.lastError}\n` +
            `The provider/model failed and no working fallback was available. ` +
            `Add a working provider with /login, then set a fallback chain with /fallback (e.g. "/fallback openai:gpt-4o").`,
        );
        return;
      }
      await this.checkpointAndReconstruct();
    }
    await this.runVerifyGate(sink, signal);
    // Final documentation pass: bring README.md in line with what actually shipped.
    if (!signal?.aborted) {
      await sink.notice('▶ Compose phase: readme');
      await this.runTurnWithFailover(
        '[COMPOSE · README phase] Create or update `README.md` so it accurately documents what shipped: ' +
          'a short overview, key features, install/setup steps, usage/examples, and configuration. ' +
          'Keep it consistent with the actual code and with PRD.md. Use the write/edit tools.',
        sink,
        signal,
      );
      if (this.loopInstance.lastError) {
        await sink.error(`✗ Compose README phase failed: ${this.loopInstance.lastError}`);
        return;
      }
      await this.checkpointAndReconstruct();
    }
    await sink.notice('✓ Compose lifecycle complete (plan → docs → implement → review → test → verify → readme).');
  }

  /** Commands the compose verify phase runs (config.verify, else auto-detected npm build/test). */
  private detectVerifyCommands(): string[] {
    if (this.opts.config.verify.length) return this.opts.config.verify;
    const pkgPath = join(this.cwd, 'package.json');
    const cmds: string[] = [];
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
        if (pkg.scripts?.build) cmds.push('npm run build');
        if (pkg.scripts?.test) cmds.push('npm test');
      }
    } catch {
      /* no package.json or unreadable */
    }
    return cmds;
  }

  private execVerify(cmd: string): { ok: boolean; output: string } {
    try {
      const out = execSync(cmd, { cwd: this.cwd, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, output: out };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.trim() };
    }
  }

  /** Run build/test; on failure feed the output back to the agent and retry until green (bounded). */
  private async runVerifyGate(sink: AgentSink, signal?: AbortSignal): Promise<void> {
    const cmds = this.detectVerifyCommands();
    if (cmds.length === 0) return;
    for (let attempt = 1; attempt <= 3 && !signal?.aborted; attempt++) {
      const failures: string[] = [];
      for (const cmd of cmds) {
        await sink.notice(`▶ verify: ${cmd}`);
        const r = this.execVerify(cmd);
        if (!r.ok) failures.push(`$ ${cmd}\n${r.output.slice(-2000)}`);
      }
      if (failures.length === 0) {
        await sink.notice('✓ verify passed (build/tests green).');
        return;
      }
      if (attempt === 3) {
        await sink.notice('⚠ verify still failing after 3 attempts — stopping the loop.');
        return;
      }
      await sink.notice(`✗ verify failed — fixing (attempt ${attempt}/3)…`);
      await this.loopInstance.run(
        `The verification commands FAILED. Fix the code so they pass, then stop.\n\n${failures.join('\n\n')}`,
        sink,
        signal,
      );
      await this.checkpointAndReconstruct();
    }
  }

  /** Ask an independent judge (configurable model) whether the goal condition is truly met. */
  private async judgeGoal(): Promise<{ satisfied: boolean; reason: string }> {
    if (!this.goalCondition) return { satisfied: true, reason: 'no goal' };
    const model = this.opts.config.judgeModel ?? this.state.model;
    const transcript = this.loopInstance.messages
      .slice(-12)
      .map((m) => `${m.role}: ${messageText(m).replace(/\s+/g, ' ').slice(0, 600)}`)
      .join('\n');
    const ask = async (strict: boolean): Promise<{ satisfied: boolean; reason: string } | undefined> => {
      try {
        const provider = this.opts.providerRegistry.create(this.state.provider, this.opts.config);
        const text =
          `You are a STRICT completion judge. Goal:\n"${this.goalCondition}"\n\n` +
          `Conversation:\n${transcript}\n\n` +
          `Has the goal been FULLY achieved (evidence in the conversation), not merely attempted or claimed? ` +
          (strict ? `Output ONLY this JSON and nothing else: ` : ``) +
          `{"satisfied": true|false, "reason": "<short>"}`;
        let out = '';
        for await (const evt of provider.chat([{ role: 'user', content: [{ type: 'text', text }] }], [], { model })) {
          if (evt.type === 'text') out += evt.text;
        }
        const m = out.match(/\{[\s\S]*?\}/);
        if (m) {
          const j = JSON.parse(m[0]) as { satisfied?: unknown; reason?: unknown };
          return { satisfied: Boolean(j.satisfied), reason: String(j.reason ?? '') };
        }
        // Fallback: interpret a clear yes/no.
        if (/\b(not|isn'?t|incomplete|unmet|no)\b/i.test(out)) return { satisfied: false, reason: out.slice(0, 200) };
      } catch {
        /* retry / fail-open below */
      }
      return undefined;
    };
    const first = await ask(false);
    if (first) return first;
    const retry = await ask(true);
    if (retry) return retry;
    // Fail open so a flaky judge never traps the agent in an infinite loop.
    return { satisfied: true, reason: 'judge unavailable' };
  }

  private persist(): void {
    this.session.messages = [...this.loopInstance.messages];
    this.session.provider = this.state.provider;
    this.session.model = this.state.model;
    this.opts.sessionStore.save(this.session);
  }
}
