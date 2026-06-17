/** Observable store + AgentSink bridge for the Ink TUI. Keeps React decoupled from the loop. */
import type { AgentSink } from '../../agent/output.js';
import type { ToolCall, Usage } from '../../types/index.js';
import type { ToolExecution } from '../../tools/types.js';

export type TuiItemKind = 'user' | 'assistant' | 'tool' | 'result' | 'notice' | 'error';

export interface TuiItem {
  id: number;
  kind: TuiItemKind;
  text: string;
  isError?: boolean;
}

export interface TuiStatus {
  provider: string;
  model: string;
  mode: string;
  inTokens: number;
  outTokens: number;
}

export interface OverlayItem {
  label: string;
  description: string;
}

export interface TuiOverlay {
  title: string;
  tabs: string[];
  activeTab: number;
  filter: string;
  index: number;
  /** Items per tab. */
  data: OverlayItem[][];
}

export interface TuiSnapshot {
  items: TuiItem[];
  stream: string;
  busy: boolean;
  busySince: number;
  toolCount: number;
  status: TuiStatus;
  approval: { summary: string; toolName: string; index: number } | null;
  select: { title: string; options: string[]; index: number } | null;
  overlay: TuiOverlay | null;
  inputReq: { prompt: string; password: boolean } | null;
  exiting: boolean;
}

type Listener = () => void;

/** Filtered items for the active overlay tab. */
export function filterOverlay(o: TuiOverlay): OverlayItem[] {
  const list = o.data[o.activeTab] ?? [];
  const q = o.filter.trim().toLowerCase();
  if (!q) return list;
  const filtered = list.filter((i) => i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  if (!filtered.length && o.title === 'Plugins' && o.tabs[o.activeTab] === 'Discover' && looksLikeInstallSource(o.filter.trim())) {
    return [{ label: o.filter.trim(), description: 'Install from git URL or local path' }];
  }
  return filtered;
}

function looksLikeInstallSource(value: string): boolean {
  return /^(https?:\/\/|git@|\.{0,2}\/|\/)/.test(value);
}

export class TuiController {
  private snapshot: TuiSnapshot;
  private readonly listeners = new Set<Listener>();
  private nextId = 1;
  private approvalResolve?: (v: boolean) => void;
  private selectResolve?: (v: string | null) => void;

  /** Set by the frontend; runs an input line through the runtime. */
  onSubmit?: (input: string) => Promise<void>;
  /** Set by the frontend; aborts the current turn. */
  onInterrupt?: () => void;
  /** Set by the frontend; cycles permission mode and returns the new mode. */
  onCycleMode?: () => string;
  onCycleAgent?: () => string | undefined;
  /** Set by the frontend; trusts a tool for the session ("don't ask again"). */
  onApproveAlways?: (toolName: string) => void;
  /** Available slash commands for the autocomplete palette. */
  commands: Array<{ name: string; description: string }> = [];

  constructor(status: TuiStatus) {
    this.snapshot = {
      items: [],
      stream: '',
      busy: false,
      busySince: 0,
      toolCount: 0,
      status,
      approval: null,
      select: null,
      overlay: null,
      inputReq: null,
      exiting: false,
    };
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): TuiSnapshot => this.snapshot;

  private set(patch: Partial<TuiSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  private addItem(kind: TuiItemKind, text: string, isError?: boolean): void {
    this.set({ items: [...this.snapshot.items, { id: this.nextId++, kind, text, isError }] });
  }

  private flushStream(): void {
    if (this.snapshot.stream.trim()) this.addItem('assistant', this.snapshot.stream);
    if (this.snapshot.stream) this.set({ stream: '' });
  }

  // --- user actions ---
  submit(input: string): void {
    const text = input.trim();
    if (!text || this.snapshot.approval || this.snapshot.select) return;
    if (this.snapshot.busy) {
      // Queue follow-up messages and run them one at a time after the current task.
      this.queue.push(text);
      this.addItem('notice', `Queued (${this.queue.length}) — will run after the current task.`);
      return;
    }
    this.runTurn(text);
  }

  private queue: string[] = [];

  private runTurn(text: string): void {
    this.addItem('user', text);
    this.set({ busy: true, stream: '', busySince: Date.now(), toolCount: 0 });
    void this.onSubmit?.(text).finally(() => {
      this.flushStream();
      this.set({ busy: false });
      const next = this.queue.shift();
      if (next) this.runTurn(next);
    });
  }

  interrupt(): void {
    this.onInterrupt?.();
  }

  /** Show a transient notice line in the scrollback. */
  notify(text: string): void {
    this.addItem('notice', text);
  }

  /** Route a captured logger line into the scrollback (keeps raw logs off the TTY under Ink). */
  log(level: string, line: string): void {
    this.addItem(level === 'error' ? 'error' : 'notice', line, level === 'error');
  }

  /** Signal the app to exit (e.g. after /exit). */
  requestExit(): void {
    this.set({ exiting: true });
  }

  // --- free-text input (e.g. API keys) ---
  private inputResolve?: (v: string | null) => void;

  requestInput(prompt: string, opts?: { password?: boolean }): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.inputResolve = resolve;
      this.set({ inputReq: { prompt, password: opts?.password ?? false } });
    });
  }

  resolveInput(value: string | null): void {
    this.inputResolve?.(value);
    this.inputResolve = undefined;
    this.set({ inputReq: null });
  }

  cycleMode(): void {
    const mode = this.onCycleMode?.();
    if (mode) this.set({ status: { ...this.snapshot.status, mode } });
  }

  /** Cycle the primary agent (build → plan → compose) and announce it. */
  cycleAgent(): void {
    const agent = this.onCycleAgent?.();
    if (agent) this.addItem('notice', `Agent: ${agent}`);
  }

  setModel(provider: string, model: string): void {
    this.set({ status: { ...this.snapshot.status, provider, model } });
  }

  // --- approval flow ---
  requestApproval(summary: string, toolName: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.approvalResolve = resolve;
      this.set({ approval: { summary, toolName, index: 0 } });
    });
  }

  moveApproval(delta: number): void {
    const a = this.snapshot.approval;
    if (!a) return;
    this.set({ approval: { ...a, index: (a.index + delta + 3) % 3 } });
  }

  /** Confirm the highlighted approval option (0=yes, 1=always, 2=no). */
  confirmApproval(): void {
    const a = this.snapshot.approval;
    if (!a) return;
    if (a.index === 1) this.onApproveAlways?.(a.toolName);
    const allow = a.index === 0 || a.index === 1;
    this.approvalResolve?.(allow);
    this.approvalResolve = undefined;
    this.set({ approval: null });
  }

  resolveApproval(decision: boolean): void {
    this.approvalResolve?.(decision);
    this.approvalResolve = undefined;
    this.set({ approval: null });
  }

  // --- select flow ---
  requestSelect(title: string, options: string[], current: number): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.selectResolve = resolve;
      this.set({ select: { title, options, index: Math.max(0, current) } });
    });
  }

  moveSelect(delta: number): void {
    const s = this.snapshot.select;
    if (!s) return;
    const index = (s.index + delta + s.options.length) % s.options.length;
    this.set({ select: { ...s, index } });
  }

  confirmSelect(): void {
    const s = this.snapshot.select;
    this.selectResolve?.(s ? s.options[s.index]! : null);
    this.selectResolve = undefined;
    this.set({ select: null });
  }

  cancelSelect(): void {
    this.selectResolve?.(null);
    this.selectResolve = undefined;
    this.set({ select: null });
  }

  // --- tabbed overlay (/help, /plugin) ---
  /** Plugin data + install action, supplied by the frontend. */
  pluginsProvider?: () => { installed: OverlayItem[]; registry: OverlayItem[] };
  onPluginInstall?: (name: string) => string;
  private overlayOnEnter?: (tab: number, item: OverlayItem) => void;

  /** Built-in slash command names (for the Help "General" vs "Custom" split). */
  builtinNames = new Set<string>();

  openOverlay(spec: {
    title: string;
    tabs: string[];
    data: OverlayItem[][];
    onEnter?: (tab: number, item: OverlayItem) => void;
  }): void {
    this.overlayOnEnter = spec.onEnter;
    this.set({ overlay: { title: spec.title, tabs: spec.tabs, activeTab: 0, filter: '', index: 0, data: spec.data } });
  }

  closeOverlay(): void {
    this.overlayOnEnter = undefined;
    this.set({ overlay: null });
  }

  overlayTab(delta: number): void {
    const o = this.snapshot.overlay;
    if (!o) return;
    const activeTab = (o.activeTab + delta + o.tabs.length) % o.tabs.length;
    this.set({ overlay: { ...o, activeTab, index: 0, filter: '' } });
  }

  overlayMove(delta: number): void {
    const o = this.snapshot.overlay;
    if (!o) return;
    const list = filterOverlay(o);
    if (!list.length) return;
    this.set({ overlay: { ...o, index: (o.index + delta + list.length) % list.length } });
  }

  overlayType(ch: string | null): void {
    const o = this.snapshot.overlay;
    if (!o) return;
    const filter = ch === null ? o.filter.slice(0, -1) : o.filter + ch;
    this.set({ overlay: { ...o, filter, index: 0 } });
  }

  overlayEnter(): void {
    const o = this.snapshot.overlay;
    if (!o) return;
    const item = filterOverlay(o)[o.index];
    if (item && this.overlayOnEnter) this.overlayOnEnter(o.activeTab, item);
    else if (o.title === 'Plugins' && o.activeTab === 1 && o.filter.trim() && this.overlayOnEnter) {
      this.overlayOnEnter(o.activeTab, { label: o.filter.trim(), description: 'install source' });
    }
  }

  /** Open a tabbed overlay for /help or /plugin. Returns true if handled. */
  tryOpenOverlay(input: string): boolean {
    const t = input.trim();
    if (t === '/help') {
      const all = this.commands.map((c) => ({ label: `/${c.name}`, description: c.description }));
      const general = all.filter((c) => this.builtinNames.has(c.label.slice(1)));
      const custom = all.filter((c) => !this.builtinNames.has(c.label.slice(1)));
      this.openOverlay({ title: 'Help', tabs: ['General', 'Commands', 'Custom'], data: [general, all, custom] });
      return true;
    }
    if (t === '/plugin' && this.pluginsProvider) {
      const { installed, registry } = this.pluginsProvider();
      this.openOverlay({
        title: 'Plugins',
        tabs: ['Installed', 'Discover'],
        data: [installed, registry],
        onEnter: (tab, item) => {
          if (tab === 1 && this.onPluginInstall) {
            const msg = this.onPluginInstall(item.label);
            this.addItem('notice', msg);
            const refreshed = this.pluginsProvider?.();
            if (refreshed) {
              this.openOverlay({
                title: 'Plugins',
                tabs: ['Installed', 'Discover'],
                data: [refreshed.installed, refreshed.registry],
                onEnter: this.overlayOnEnter,
              });
            } else {
              this.closeOverlay();
            }
          }
        },
      });
      return true;
    }
    return false;
  }

  /** AgentSink that writes streaming output into the store. */
  sink(): AgentSink {
    return {
      text: (d: string) => this.set({ stream: this.snapshot.stream + d }),
      toolCall: (call: ToolCall) => {
        this.flushStream();
        this.set({ toolCount: this.snapshot.toolCount + 1 });
        const args =
          (typeof call.input.command === 'string' && call.input.command) ||
          (typeof call.input.path === 'string' && call.input.path) ||
          (typeof call.input.pattern === 'string' && call.input.pattern) ||
          '';
        this.addItem('tool', `${call.name}(${String(args).slice(0, 80)})`);
      },
      toolResult: (_call: ToolCall, result: ToolExecution) => {
        const preview = result.output.split('\n').slice(0, 12).join('\n');
        this.addItem('result', preview, result.isError);
      },
      usage: (u: Usage) => {
        this.flushStream();
        this.set({
          status: {
            ...this.snapshot.status,
            inTokens: this.snapshot.status.inTokens + u.inputTokens,
            outTokens: this.snapshot.status.outTokens + u.outputTokens,
          },
        });
      },
      notice: (m: string) => this.addItem('notice', m),
      error: (m: string) => this.addItem('error', m, true),
    };
  }
}
