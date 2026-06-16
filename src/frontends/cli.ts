/** CLI frontend: readline REPL over the headless AgentRuntime. */
import { createInterface, type Interface } from 'node:readline';
import type { AgentSink } from '../agent/output.js';
import type { ToolCall, Usage } from '../types/index.js';
import type { ToolExecution } from '../tools/types.js';
import type { ApprovalHook } from '../agent/loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { ProviderRegistry } from '../providers/registry.js';
import { SessionStore } from '../agent/session.js';
import { CommandRegistry } from '../agent/commands.js';
import type { Config } from '../config/index.js';
import type { ApprovalRequest, Frontend } from './types.js';
import { type ApprovalPrompt } from '../permissions/index.js';
import { AgentRuntime } from '../agent/runtime.js';
import { c, box } from '../ui/ansi.js';
import { thinkcoLogo } from '../ui/banner.js';
import { MarkdownStream } from '../ui/markdown.js';
import { Spinner } from '../ui/spinner.js';
import { promptSelect } from '../ui/select.js';
import { VERSION } from '../index.js';

/** Summarize a tool call's arguments for a compact one-line display. */
function summarizeArgs(call: ToolCall): string {
  const i = call.input;
  if (typeof i.command === 'string') return i.command;
  if (typeof i.path === 'string') return i.path;
  if (typeof i.pattern === 'string') return i.pattern;
  if (typeof i.url === 'string') return i.url;
  if (typeof i.subcommand === 'string')
    return `${i.subcommand}${Array.isArray(i.args) ? ' ' + (i.args as string[]).join(' ') : ''}`;
  const json = JSON.stringify(i);
  return json.length > 60 ? json.slice(0, 60) + '…' : json;
}

/** AgentSink that renders Claude-style output: markdown text + ⏺/⎿ tool blocks. */
export class CliSink implements AgentSink {
  private readonly md: MarkdownStream;

  constructor(
    private readonly write: (s: string) => void = (s) => process.stdout.write(s),
    private readonly onUsage?: (u: Usage) => void,
    private readonly spinner?: Spinner,
  ) {
    this.md = new MarkdownStream(this.write);
  }

  private stopSpinner(): void {
    this.spinner?.stop();
  }

  text(delta: string): void {
    this.stopSpinner();
    this.md.push(delta);
  }

  toolCall(call: ToolCall): void {
    this.stopSpinner();
    this.md.flush();
    this.write(`\n${c.green('⏺')} ${c.bold(call.name)}${c.dim('(' + summarizeArgs(call) + ')')}\n`);
  }

  toolResult(_call: ToolCall, result: ToolExecution): void {
    this.stopSpinner();
    const marker = result.isError ? c.red('  ⎿') : c.gray('  ⎿');
    const lines = result.output.split('\n');
    const shown = lines.slice(0, 18);
    const fmt = (l: string): string => {
      if (l.startsWith('+ ')) return c.green(l);
      if (l.startsWith('- ')) return c.red(l);
      return c.dim(l);
    };
    const body = shown.map((l, i) => (i === 0 ? `${marker}  ${fmt(l)}` : `      ${fmt(l)}`)).join('\n');
    this.write(`${body}\n`);
    if (lines.length > 18) this.write(c.dim(`      … (+${lines.length - 18} more lines)\n`));
  }

  usage(usage: Usage): void {
    this.stopSpinner();
    this.md.flush();
    this.onUsage?.(usage);
  }

  notice(message: string): void {
    this.stopSpinner();
    this.write(`${c.gray(message)}\n`);
  }

  error(message: string): void {
    this.stopSpinner();
    this.write(`${c.red('⚠ ' + message)}\n`);
  }

  /** Flush any buffered markdown (call at end of a turn). */
  finalize(): void {
    this.md.flush();
  }
}

export interface CliFrontendOptions {
  config: Config;
  providerRegistry: ProviderRegistry;
  tools: ToolRegistry;
  sessionStore: SessionStore;
  system?: string;
  resume?: boolean;
  resumeId?: string;
  approve?: ApprovalHook;
  auditPath?: string;
  availableModels?: string[];
}

export class CliFrontend implements Frontend {
  readonly name = 'cli';
  private readonly runtime: AgentRuntime;
  private readonly spinner = new Spinner();
  private activeRl?: Interface;

  constructor(private readonly opts: CliFrontendOptions) {
    const ui = {
      approve: (p: ApprovalPrompt) => this.promptApproval(p),
      select: (title: string, items: string[], current: number) => this.promptSelect(title, items, current),
      input: (prompt: string, opts?: { password?: boolean }) => this.promptInput(prompt, opts),
    };
    this.runtime = new AgentRuntime({
      config: opts.config,
      providerRegistry: opts.providerRegistry,
      tools: opts.tools,
      sessionStore: opts.sessionStore,
      ui,
      system: opts.system,
      resume: opts.resume,
      resumeId: opts.resumeId,
      approve: opts.approve,
      auditPath: opts.auditPath,
      availableModels: opts.availableModels,
      origin: 'cli',
    });
  }

  createSink(): AgentSink {
    return new CliSink((s) => process.stdout.write(s), (u) => this.runtime.usage.add(u), this.spinner);
  }

  /** Process a single line of input (delegates to the runtime). Kept for tests/back-compat. */
  processLine(line: string, sink: AgentSink, signal?: AbortSignal): Promise<{ exit: boolean }> {
    return this.runtime.handleInput(line, sink, signal);
  }

  async requestApproval(req: ApprovalRequest): Promise<boolean> {
    return this.promptApproval({
      call: req.call,
      tool: req.tool,
      assessment: { risk: req.risk as never, destructive: false, secret: false, protected: false, reasons: req.reason ? [req.reason] : [] },
      summary: `${req.call.name}(${JSON.stringify(req.call.input)})`,
    });
  }

  private promptSelect(title: string, items: string[], current: number): Promise<string | null> {
    const controls = this.activeRl
      ? { pause: () => this.activeRl!.pause(), resume: () => this.activeRl!.resume() }
      : undefined;
    return promptSelect(title, items, current, controls);
  }

  /** Free-text prompt; masks input when password. */
  private promptInput(prompt: string, opts?: { password?: boolean }): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      if (opts?.password) {
        // Mask typed characters.
        const rlAny = rl as unknown as { _writeToOutput?: (s: string) => void; output?: NodeJS.WriteStream };
        rlAny._writeToOutput = (s: string) => {
          if (s.includes('\n') || s.includes('\r')) process.stdout.write(s);
          else if (s.startsWith(prompt)) process.stdout.write(s);
          else process.stdout.write('*');
        };
      }
      rl.question(`${c.cyan(prompt)} `, (answer) => {
        rl.close();
        if (opts?.password) process.stdout.write('\n');
        const v = answer.trim();
        resolve(v.length ? v : null);
      });
    });
  }

  private promptApproval(prompt: ApprovalPrompt): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      process.stdout.write(`\n${c.yellow('Approve action?')}\n  ${prompt.summary}\n`);
      rl.question(c.dim(`[y]es once · [a]lways allow ${prompt.call.name} · [N]o: `), (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        if (a.startsWith('a')) {
          const allow = this.opts.config.permissions.allow;
          if (!allow.includes(prompt.call.name)) allow.push(prompt.call.name);
          resolve(true);
        } else {
          resolve(a.startsWith('y'));
        }
      });
    });
  }

  async start(): Promise<void> {
    const commandNames = this.runtime.commandNames();
    const completer = (line: string): [string[], string] => {
      if (!line.startsWith('/')) return [[], line];
      const hits = commandNames.filter((n) => n.startsWith(line));
      return [hits.length ? hits : commandNames, line];
    };
    const rl: Interface = createInterface({ input: process.stdin, output: process.stdout, completer });
    this.activeRl = rl;
    process.stdout.write(
      '\n' +
        thinkcoLogo() +
        '\n' +
        box(
          [
            `${c.dim('v' + VERSION)}   ${c.dim('multi-provider coding agent')}`,
            '',
            `${c.dim('provider')}  ${c.cyan(this.runtime.state.provider)}`,
            `${c.dim('model')}     ${c.cyan(this.runtime.state.model)}`,
            `${c.dim('mode')}      ${c.cyan(this.runtime.getMode())} ${c.dim('(Shift+Tab to cycle)')}`,
            `${c.dim('cwd')}       ${process.cwd()}`,
            '',
            c.dim('/help · /models · /mode · /provider · /usage · /exit'),
          ],
          { color: c.gray, padding: 2 },
        ) +
        '\n',
    );

    let controller: AbortController | null = null;
    let closed = false;
    rl.on('close', () => {
      closed = true;
    });
    const onKeypress = (_s: string, key: { name?: string; shift?: boolean } | undefined): void => {
      if (key && key.name === 'tab' && key.shift) {
        const mode = this.runtime.cycleMode();
        process.stdout.write(`\n${c.dim('permission mode →')} ${c.cyan(mode)}\n`);
        rl.prompt();
      }
    };
    process.stdin.on('keypress', onKeypress);
    const onSigint = () => {
      if (controller) {
        controller.abort();
        process.stdout.write('\n^C (turn interrupted)\n');
      } else {
        rl.close();
      }
    };
    process.on('SIGINT', onSigint);

    const sink = this.createSink();
    try {
      for (;;) {
        if (closed) break;
        const line = await new Promise<string | null>((resolve) => {
          if (closed) {
            resolve(null);
            return;
          }
          rl.once('close', () => resolve(null));
          rl.question(`\n${c.cyan('❯')} `, (answer) => resolve(answer));
        });
        if (line === null) break;
        controller = new AbortController();
        const isCmd = CommandRegistry.isCommand(line.trim());
        if (line.trim() && !isCmd) this.spinner.start();
        try {
          const { exit } = await this.runtime.handleInput(line, sink, controller.signal);
          if (exit) break;
        } catch (err) {
          this.spinner.stop();
          await sink.error(`Error: ${(err as Error).message ?? String(err)}`);
        } finally {
          this.spinner.stop();
          (sink as CliSink).finalize();
          controller = null;
        }
      }
    } finally {
      process.off('SIGINT', onSigint);
      process.stdin.off('keypress', onKeypress);
      if (!closed) rl.close();
    }
  }
}
