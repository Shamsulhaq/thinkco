/** Telegram frontend: operate thinkco remotely over chat. Remote = remote code execution.
 *  Built on the shared AgentRuntime so it inherits commands, skills, plugins, and permissions. */
import { isCompletionSummaryNotice, type AgentSink } from '../../agent/output.js';
import type { ToolCall, Usage } from '../../types/index.js';
import type { ToolExecution } from '../../tools/types.js';
import { ToolRegistry } from '../../tools/registry.js';
import { registerCoreTools } from '../../tools/core/index.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { SessionStore } from '../../agent/session.js';
import { AgentRuntime } from '../../agent/runtime.js';
import type { Config } from '../../config/index.js';
import type { ApprovalPrompt } from '../../permissions/index.js';
import type { Frontend } from '../types.js';
import { isAbsolute, join, resolve } from 'node:path';
import type { TelegramChatAction, TelegramTransport, TelegramUpdate } from './transport.js';
import { redactSecrets } from './redact.js';
import { errorWithCause } from '../../util/errors.js';

export interface TelegramFrontendOptions {
  transport: TelegramTransport;
  config: Config;
  /** Allowlisted Telegram user IDs. Everyone else is ignored. */
  allowlist: number[];
  providerRegistry?: ProviderRegistry;
  cwd?: string;
  auditPath?: string;
}

interface ChatState {
  runtime: AgentRuntime;
  busy: boolean;
  queue: string[];
  sink?: TelegramSink;
  createdFiles: Set<string>;
}

/** Human-friendly status line for a tool the agent is about to run. */
function activityFor(name: string): string {
  switch (name) {
    case 'web_search': return '🔍 Searching the web…';
    case 'web_fetch': return '🌐 Fetching a page…';
    case 'read': return '📖 Reading files…';
    case 'list': return '📂 Listing files…';
    case 'write':
    case 'edit': return '✏️ Editing files…';
    case 'shell': return '⚙️ Running a command…';
    case 'grep':
    case 'glob':
    case 'code': return '🔎 Searching the code…';
    case 'git': return '🔧 Running git…';
    case 'knowledge': return '📚 Searching knowledge…';
    case 'subagent': return '🤖 Delegating to a sub-agent…';
    case 'task': return '🗒️ Planning…';
    case 'use_aws': return '☁️ Calling AWS…';
    default: return `⚙️ ${name}…`;
  }
}

function chatActionFor(name: string): TelegramChatAction {
  switch (name) {
    case 'web_search':
    case 'web_fetch':
      return 'find_location';
    case 'read':
    case 'list':
    case 'grep':
    case 'glob':
    case 'code':
    case 'knowledge':
    case 'write':
    case 'edit':
      return 'upload_document';
    default:
      return 'typing';
  }
}

function splitShellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words;
}

function removablePathsFromShell(command: unknown): string[] {
  if (typeof command !== 'string') return [];
  const words = splitShellWords(command.trim());
  if (words[0] !== 'rm') return [];
  const paths: string[] = [];
  for (const word of words.slice(1)) {
    if (word === '--') continue;
    if (word.startsWith('-')) {
      if (/[rR]/.test(word)) return [];
      continue;
    }
    paths.push(word);
  }
  return paths;
}

/** A sink that buffers assistant output and edits a single Telegram message as it grows. */
class TelegramSink implements AgentSink {
  private buffer = '';
  private messageId?: number;
  private lastFlush = 0;
  private lastText = '';
  private lastAction = 0;
  private status = '💭 Thinking…';

  constructor(
    private readonly transport: TelegramTransport,
    private readonly chatId: number,
    private readonly onToolResult?: (call: ToolCall, result: ToolExecution) => void,
  ) {}

  private async flush(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastFlush < 600) return; // throttle edits (rate limits)
    this.lastFlush = now;
    const body = redactSecrets(this.buffer).slice(-3500);
    const text = (this.status ? (body ? `${this.status}\n\n${body}` : this.status) : body) || '…';
    if (text === this.lastText) return; // Telegram rejects identical edits ("not modified").
    this.lastText = text;
    try {
      if (this.messageId === undefined) {
        this.messageId = await this.transport.sendMessage(this.chatId, text);
      } else {
        await this.transport.editMessage(this.chatId, this.messageId, text);
      }
    } catch (err) {
      // A streaming UI edit failing must never crash the bot; the next flush retries with newer text.
      if (!/not modified/i.test(String(err))) this.lastText = ''; // allow retry on real failures
    }
  }

  private async chatAction(action: TelegramChatAction = 'typing', force = false): Promise<void> {
    if (!this.transport.sendChatAction) return;
    const now = Date.now();
    if (!force && now - this.lastAction < 4000) return;
    this.lastAction = now;
    try {
      await this.transport.sendChatAction(this.chatId, action);
    } catch {
      // Non-fatal: chat actions are purely presentational.
    }
  }

  start(): Promise<void> {
    return this.chatAction('typing', true);
  }

  /** Re-post the current status/output so it becomes the newest chat message. */
  async bumpToLatest(): Promise<void> {
    const body = redactSecrets(this.buffer).slice(-3500);
    const text = (this.status ? (body ? `${this.status}\n\n${body}` : this.status) : body) || '…';
    this.messageId = await this.transport.sendMessage(this.chatId, text);
    this.lastText = text;
    this.lastFlush = Date.now();
  }

  async text(delta: string): Promise<void> {
    this.buffer += delta;
    if (this.status && this.status !== '✍️ Responding…') this.status = '✍️ Responding…';
    await this.chatAction('typing');
    await this.flush();
  }
  async toolCall(call: ToolCall): Promise<void> {
    this.status = activityFor(call.name);
    await this.chatAction(chatActionFor(call.name), true);
    await this.flush(true);
  }
  async toolResult(_call: ToolCall, result: ToolExecution): Promise<void> {
    if (result.isError) this.buffer += `\n⚠ ${result.output}\n`;
    this.onToolResult?.(_call, result);
    this.status = '💭 Working…';
    await this.flush(true);
  }
  usage(_usage: Usage): void {
    /* tracked by the runtime */
  }
  async notice(message: string): Promise<void> {
    if (isCompletionSummaryNotice(message)) this.buffer += `\n────────────\n${message}\n`;
    else this.buffer += `\n${message}\n`;
    await this.chatAction('typing');
    await this.flush(true);
  }
  async error(message: string): Promise<void> {
    this.buffer += `\n⚠ ${message}\n`;
    await this.chatAction('typing');
    await this.flush(true);
  }
  finalize(): Promise<void> {
    this.status = ''; // drop the working indicator; show the final answer only
    if (!this.buffer.trim()) this.buffer = '✓ Done.';
    return this.flush(true);
  }
}

export class TelegramFrontend implements Frontend {
  readonly name = 'telegram';
  private readonly transport: TelegramTransport;
  private readonly registry: ProviderRegistry;
  private readonly tools: ToolRegistry;
  private readonly sessions: SessionStore;
  private readonly chats = new Map<number, ChatState>();
  private mcp?: import('../../mcp/manager.js').McpManager;
  private readonly pendingApprovals = new Map<number, { resolve: (decision: boolean) => void; messageId?: number }>();
  private readonly pendingSelects = new Map<number, (value: string | null) => void>();

  constructor(private readonly opts: TelegramFrontendOptions) {
    this.transport = opts.transport;
    this.registry = opts.providerRegistry ?? new ProviderRegistry();
    this.tools = new ToolRegistry();
    registerCoreTools(this.tools);
    this.sessions = new SessionStore(join(opts.cwd ?? process.cwd(), '.thinkco', 'sessions-telegram'));
    this.transport.onUpdate((u) => {
      void this.handleUpdate(u).catch(async (err) => {
        try {
          await this.transport.sendMessage(u.chatId, `⚠ ${(err as Error).message ?? String(err)}`);
        } catch {
          // ignore — never let a handler error crash the poll loop
        }
      });
    });
  }

  private isAllowed(userId: number): boolean {
    return this.opts.allowlist.includes(userId);
  }

  createSink(): AgentSink {
    throw new Error('TelegramFrontend creates per-chat sinks internally.');
  }

  async requestApproval(): Promise<boolean> {
    return false; // approvals flow through the per-chat runtime engine → inline buttons
  }

  /** Inline-button approval; resolves when the user taps Approve/Deny. */
  private promptApproval(chatId: number, prompt: ApprovalPrompt): Promise<boolean> {
    const state = this.chats.get(chatId);
    if (this.shouldAutoApprove(chatId, prompt, state)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const pending: { resolve: (decision: boolean) => void; messageId?: number } = { resolve };
      this.pendingApprovals.set(chatId, pending);
      void this.transport
        .sendButtons(chatId, redactSecrets(`Approve action?\n${prompt.summary}`), [
          { text: '✅ Approve', data: 'approve' },
          { text: '❌ Deny', data: 'deny' },
        ])
        .then((messageId) => {
          pending.messageId = messageId;
        });
    });
  }

  private shouldAutoApprove(chatId: number, prompt: ApprovalPrompt, state: ChatState | undefined): boolean {
    const { call, assessment } = prompt;
    if (assessment.secret || assessment.protected || assessment.destructive) return false;
    if (assessment.risk === 'read' || assessment.risk === 'network') return true;
    const createdFiles = state?.createdFiles;
    if (!createdFiles?.size) return false;
    if ((call.name === 'write' || call.name === 'edit') && typeof call.input.path === 'string') {
      return createdFiles.has(this.resolveChatPath(call.input.path));
    }
    const removable = removablePathsFromShell(call.input.command);
    return call.name === 'shell' && removable.length > 0 && removable.every((p) => createdFiles.has(this.resolveChatPath(p)));
  }

  private resolveChatPath(path: string): string {
    const cwd = this.opts.cwd ?? process.cwd();
    return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  }

  private trackCreatedFile(state: ChatState, call: ToolCall, result: ToolExecution): void {
    if (result.isError || call.name !== 'write' || typeof call.input.path !== 'string') return;
    if (/^Created\b/.test(result.output)) state.createdFiles.add(this.resolveChatPath(call.input.path));
  }

  private async dismissApprovalPrompt(chatId: number, decision: boolean, messageId?: number): Promise<void> {
    if (!messageId) return;
    if (this.transport.deleteMessage) {
      try {
        await this.transport.deleteMessage(chatId, messageId);
        return;
      } catch {
        // Fall back to editing if Telegram refuses deletion.
      }
    }
    try {
      await this.transport.editMessage(chatId, messageId, decision ? 'Approved. Continuing…' : 'Denied.');
    } catch {
      // Non-fatal; the approval resolver must still continue.
    }
  }

  /** Numbered-button selection (Telegram has no arrow nav). Caps to 8 options. */
  private promptSelect(chatId: number, title: string, options: string[]): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const shown = options.slice(0, 8);
      this.pendingSelects.set(chatId, resolve);
      void this.transport.sendButtons(
        chatId,
        redactSecrets(`${title}\n${shown.map((o, i) => `${i + 1}. ${o}`).join('\n')}`),
        shown.map((_, i) => ({ text: String(i + 1), data: `sel${i}` })),
      );
      // Remember the option list for resolution.
      this.selectOptions.set(chatId, shown);
    });
  }

  private readonly selectOptions = new Map<number, string[]>();

  private getChat(chatId: number, userId: number): ChatState {
    let state = this.chats.get(chatId);
    if (!state) {
      const runtime = new AgentRuntime({
        config: this.opts.config,
        providerRegistry: this.registry,
        tools: this.tools,
        sessionStore: this.sessions,
        cwd: this.opts.cwd,
        origin: `telegram:${userId}`,
        auditPath: this.opts.auditPath ?? join(this.opts.cwd ?? process.cwd(), '.thinkco', 'audit-telegram.log'),
        strictRemote: true,
        system: 'You are thinkco operating remotely over Telegram. Be concise and safe.',
        ui: {
          approve: (p) => this.promptApproval(chatId, p),
          select: (title, options) => this.promptSelect(chatId, title, options),
        },
      });
      state = { runtime, busy: false, queue: [], createdFiles: new Set<string>() };
      this.chats.set(chatId, state);
    }
    return state;
  }

  /** Handle a single incoming update. Public for testing. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.isAllowed(update.userId)) return; // ignore unauthorized users silently

    if (update.kind === 'callback') {
      const data = update.data ?? '';
      if (data === 'approve' || data === 'deny') {
        const pending = this.pendingApprovals.get(update.chatId);
        if (pending) {
          this.pendingApprovals.delete(update.chatId);
          const decision = data === 'approve';
          await this.dismissApprovalPrompt(update.chatId, decision, pending.messageId ?? update.messageId);
          await this.chats.get(update.chatId)?.sink?.bumpToLatest();
          pending.resolve(decision);
        }
      } else if (data.startsWith('sel')) {
        const resolver = this.pendingSelects.get(update.chatId);
        if (resolver) {
          this.pendingSelects.delete(update.chatId);
          const idx = Number(data.slice(3));
          const opts = this.selectOptions.get(update.chatId) ?? [];
          resolver(opts[idx] ?? null);
        }
      }
      if (update.callbackId) await this.transport.answerCallback(update.callbackId);
      return;
    }

    const text = (update.text ?? '').trim();
    if (!text) return;

    const state = this.getChat(update.chatId, update.userId);
    state.queue.push(text);
    if (state.busy) {
      await this.transport.sendMessage(update.chatId, `⏳ Queued (#${state.queue.length}) — I'll get to it next.`);
      return;
    }
    await this.drain(state, update.chatId);
  }

  /** Process queued messages for a chat one at a time, in order. */
  private async drain(state: ChatState, chatId: number): Promise<void> {
    state.busy = true;
    try {
      while (state.queue.length) {
        const text = state.queue.shift()!;
        const sink = new TelegramSink(this.transport, chatId, (call, result) => this.trackCreatedFile(state, call, result));
        state.sink = sink;
        try {
          await sink.start();
          await state.runtime.handleInput(text, sink);
          await sink.finalize();
        } catch (err) {
          await sink.error(`Error: ${(err as Error).message ?? String(err)}`);
          await sink.finalize();
        } finally {
          if (state.sink === sink) state.sink = undefined;
        }
      }
    } finally {
      state.busy = false;
    }
  }

  async start(): Promise<void> {
    const { logger } = await import('../../util/logger.js');
    // Auto-start MCP servers (config + Claude Code plugins) into the shared tool registry.
    try {
      const { startConfiguredMcp } = await import('../../plugins/claudeMcp.js');
      this.mcp = await startConfiguredMcp(this.tools, this.opts.config, this.opts.cwd ?? process.cwd(), (m) => logger.info(m));
    } catch {
      // non-fatal — coding still works without MCP tools
    }
    // Best-effort connectivity confirmation: report the bot identity if the transport supports it.
    try {
      const me = await this.transport.getMe?.();
      if (me) {
        logger.info(`Telegram connected as @${me.username ?? me.first_name ?? me.id} (${this.opts.allowlist.length} allowed user(s)). Listening…`);
      }
    } catch (err) {
      logger.warn(`Telegram getMe failed: ${errorWithCause(err)}`);
      logger.warn('Polling will keep retrying; check the bot token, network, webhook state, or duplicate bot processes.');
    }
    await this.transport.start();
  }

  /** Stop polling and shut down any managed MCP servers. */
  async stop(): Promise<void> {
    await this.transport.stop();
    await this.mcp?.shutdown();
  }
}
