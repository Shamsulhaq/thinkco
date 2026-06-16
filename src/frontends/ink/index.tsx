/** Ink TUI frontend: full-screen-style React terminal UI over the headless AgentRuntime. */
import React from 'react';
import { render } from 'ink';
import type { Config } from '../../config/index.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { ToolRegistry } from '../../tools/registry.js';
import { SessionStore } from '../../agent/session.js';
import { AgentRuntime } from '../../agent/runtime.js';
import { PluginManager, searchRegistry } from '../../plugins/index.js';
import { join } from 'node:path';
import type { AgentSink } from '../../agent/output.js';
import type { Frontend } from '../types.js';
import { TuiController } from './controller.js';
import { App } from './App.js';

export interface InkFrontendOptions {
  config: Config;
  providerRegistry: ProviderRegistry;
  tools: ToolRegistry;
  sessionStore: SessionStore;
  resume?: boolean;
  resumeId?: string;
  auditPath?: string;
  availableModels?: string[];
  cwd?: string;
}

export class InkFrontend implements Frontend {
  readonly name = 'ink';
  private readonly runtime: AgentRuntime;
  private readonly controller: TuiController;
  private controllerSink!: AgentSink;
  private current: AbortController | null = null;

  constructor(opts: InkFrontendOptions) {
    const ui = {
      approve: (p: { summary: string; call: { name: string }; tool?: unknown }) =>
        this.controller.requestApproval(p.summary, p.call.name),
      select: (title: string, items: string[], current: number) =>
        this.controller.requestSelect(title, items, current),
      input: (prompt: string, opts?: { password?: boolean }) => this.controller.requestInput(prompt, opts),
    };
    this.runtime = new AgentRuntime({
      config: opts.config,
      providerRegistry: opts.providerRegistry,
      tools: opts.tools,
      sessionStore: opts.sessionStore,
      ui,
      resume: opts.resume,
      resumeId: opts.resumeId,
      auditPath: opts.auditPath,
      availableModels: opts.availableModels,
      origin: 'ink',
    });

    this.controller = new TuiController({
      provider: this.runtime.state.provider,
      model: this.runtime.state.model,
      mode: this.runtime.getMode(),
      inTokens: 0,
      outTokens: 0,
    });
    this.controllerSink = this.controller.sink();
    this.controller.commands = this.runtime.commands
      .list()
      .map((c) => ({ name: c.name, description: c.description }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.controller.onApproveAlways = (toolName: string) => {
      const allow = opts.config.permissions.allow;
      if (!allow.includes(toolName)) allow.push(toolName);
    };
    // Wire tabbed-overlay data for /help and /plugin.
    this.controller.builtinNames = new Set([
      'help', 'clear', 'compact', 'resume', 'models', 'login', 'mode', 'provider', 'skills', 'plugin',
      'usage', 'trust', 'init', 'doctor', 'config', 'rename', 'exit', 'agent', 'goal', 'compose', 'agents', 'budget', 'undo',
    ]);
    const pluginManager = new PluginManager(join(opts.cwd ?? process.cwd(), '.thinkco', 'plugins'));
    this.controller.pluginsProvider = () => {
      const installed = pluginManager.list().map((n) => ({
        label: n,
        description: pluginManager.isEnabled(n) ? 'enabled' : 'disabled',
      }));
      const registry = searchRegistry('').map((e) => ({ label: e.name, description: e.description }));
      return { installed, registry };
    };
    this.controller.onPluginInstall = (name: string) => {
      try {
        return `Installed "${pluginManager.install(name)}". Restart thinkco to load it.`;
      } catch (err) {
        return `Plugin error: ${(err as Error).message}`;
      }
    };

    this.controller.onCycleMode = () => this.runtime.cycleMode();
    this.controller.onCycleAgent = () => this.runtime.cycleAgent();
    this.controller.onInterrupt = () => this.current?.abort();
    this.controller.onSubmit = async (input: string) => {
      this.current = new AbortController();
      try {
        const { exit } = await this.runtime.handleInput(input, this.controllerSink, this.current.signal);
        if (exit) this.controller.requestExit();
      } catch (err) {
        await this.controllerSink.error(`Error: ${(err as Error).message ?? String(err)}`);
      } finally {
        this.controller.setModel(this.runtime.state.provider, this.runtime.state.model);
        this.current = null;
      }
    };
  }

  createSink(): AgentSink {
    return this.controllerSink;
  }

  async requestApproval(): Promise<boolean> {
    return false; // approvals flow through the runtime's engine → controller overlay
  }

  async start(): Promise<void> {
    const { box, c } = await import('../../ui/ansi.js');
    const { VERSION } = await import('../../index.js');
    process.stdout.write(
      '\n' +
        box(
          [
            `${c.magenta('✻')} ${c.bold('thinkco')} ${c.dim('v' + VERSION)}   ${c.dim('multi-provider coding agent')}`,
            '',
            `${c.dim('provider')}  ${c.cyan(this.runtime.state.provider)}`,
            `${c.dim('model')}     ${c.cyan(this.runtime.state.model)}`,
            `${c.dim('mode')}      ${c.cyan(this.runtime.getMode())} ${c.dim('(Shift+Tab to cycle)')}`,
            `${c.dim('cwd')}       ${process.cwd()}`,
            '',
            c.dim('Type a request · /help for commands · /models to switch · /exit to quit'),
          ],
          { color: c.gray, padding: 2 },
        ) +
        '\n',
    );
    // exitOnCtrlC: false — Ink would otherwise quit on the first Ctrl+C before our
    // confirm/interrupt handler in App runs. We handle Ctrl+C ourselves in useInput.
    const instance = render(React.createElement(App, { controller: this.controller }), {
      exitOnCtrlC: false,
    });
    await instance.waitUntilExit();
    process.stdout.write(`\n${c.dim('Resume this session:')} thinkco --resume ${this.runtime.session.id}\n`);
  }
}
