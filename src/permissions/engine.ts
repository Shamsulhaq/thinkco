/** Permission engine: decides whether a tool call may run, prompting when needed. */
import type { ToolCall } from '../types/index.js';
import type { Tool } from '../tools/types.js';
import { classifyAction, describeCall, isCircuitBreaker, type RiskAssessment } from './classify.js';
import type { AuditLogger } from './audit.js';
import { matchGlob } from '../tools/glob.js';
import { sandboxGuard } from './sandbox.js';
import { c } from '../ui/ansi.js';

export interface ApprovalPrompt {
  call: ToolCall;
  tool?: Tool<unknown>;
  assessment: RiskAssessment;
  summary: string;
}

/** Prompt callback supplied by a frontend (terminal prompt, Telegram buttons, ...). */
export type PromptFn = (prompt: ApprovalPrompt) => Promise<boolean>;

export interface PermissionRules {
  allow: string[];
  deny: string[];
  sandbox: boolean;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'auto' | 'bypass';

/** The order Shift+Tab cycles through (matches Claude's default cycle). */
export const MODE_CYCLE: PermissionMode[] = ['default', 'acceptEdits', 'plan'];

/** Classifier for `auto` mode: returns whether to allow a pending action. */
export type ClassifierFn = (
  call: ToolCall,
  assessment: RiskAssessment,
) => Promise<{ allow: boolean; reason?: string }>;

export interface PermissionEngineOptions {
  rules: PermissionRules;
  prompt: PromptFn;
  audit?: AuditLogger;
  origin?: string;
  /** When true (remote frontends), never auto-allow non-read actions via allow-rules. */
  strictRemote?: boolean;
  /** Initial permission mode. */
  mode?: PermissionMode;
  /** Classifier used in `auto` mode. */
  classifier?: ClassifierFn;
}

/**
 * Rule syntax:
 *   "read"                  → matches all calls to the `read` tool
 *   "shell"                 → matches all `shell` calls
 *   "shell:npm test"        → matches `shell` where command glob-matches "npm test"
 *   "git:status*"           → matches `git` where "<sub> <args>" glob-matches
 */
function ruleMatches(rule: string, call: ToolCall): boolean {
  const [toolName, pattern] = rule.includes(':') ? splitFirst(rule, ':') : [rule, undefined];
  if (toolName !== call.name) return false;
  if (!pattern) return true;
  const subject =
    typeof call.input.command === 'string'
      ? call.input.command
      : call.name === 'git'
        ? `${call.input.subcommand ?? ''} ${Array.isArray(call.input.args) ? (call.input.args as string[]).join(' ') : ''}`.trim()
        : Object.values(call.input).find((v) => typeof v === 'string') ?? '';
  return matchGlob(pattern, String(subject));
}

function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return [s.slice(0, i), s.slice(i + 1)];
}

/** Safe filesystem shell commands auto-approved in acceptEdits mode. */
const SAFE_FS_RE = /^\s*(mkdir|touch|mv|cp|rmdir|ln)\b/;
function isSafeFsCommand(command: string): boolean {
  return command.length > 0 && SAFE_FS_RE.test(command);
}

export class PermissionEngine {
  private mode: PermissionMode;
  private consecutiveBlocks = 0;
  private totalBlocks = 0;
  /** Tools temporarily pre-approved (e.g. an active skill's allowed-tools). */
  private transientAllow = new Set<string>();

  constructor(private readonly opts: PermissionEngineOptions) {
    this.mode = opts.mode ?? 'default';
  }

  /** Replace the transient allow-list (typically set per turn). */
  setTransientAllow(tools: string[]): void {
    this.transientAllow = new Set(tools);
  }

  clearTransientAllow(): void {
    this.transientAllow.clear();
  }

  private allowedByRuleOrTransient(call: ToolCall): boolean {
    return this.opts.rules.allow.some((r) => ruleMatches(r, call)) || this.transientAllow.has(call.name);
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** Cycle to the next mode in the Shift+Tab cycle. Returns the new mode. */
  cycleMode(): PermissionMode {
    const cycle = MODE_CYCLE;
    const idx = cycle.indexOf(this.mode);
    this.mode = cycle[(idx + 1) % cycle.length] ?? 'default';
    return this.mode;
  }

  /** Decide whether to allow a tool call. Returns true to proceed. */
  async decide(call: ToolCall, tool?: Tool<unknown>): Promise<boolean> {
    const assessment = classifyAction(call, tool);
    const { rules } = this.opts;
    const command = typeof call.input.command === 'string' ? call.input.command : '';
    const mutating = assessment.risk !== 'read';
    const circuitBreak = command ? isCircuitBreaker(command) : false;

    // Explicit deny always wins (every mode).
    if (rules.deny.some((r) => ruleMatches(r, call))) {
      return this.finish(call, assessment, false, true);
    }
    // Sandbox: hard-block dangerous/network/privilege shell commands (overrides every mode).
    if (rules.sandbox && call.name === 'shell' && command && !sandboxGuard(command).ok) {
      return this.finish(call, assessment, false, true);
    }

    // bypass: run everything except hard circuit-breakers.
    if (this.mode === 'bypass') {
      if (circuitBreak) return this.promptDecision(call, tool, assessment);
      return this.finish(call, assessment, true, true);
    }

    // Reads (non-secret) are safe in every remaining mode.
    if (!mutating && !assessment.secret) {
      return this.finish(call, assessment, true, true);
    }

    // Protected-path writes and secrets never auto-approve (except bypass, handled above).
    const blockedFromAuto = assessment.protected || assessment.secret || assessment.destructive || circuitBreak;

    switch (this.mode) {
      case 'plan':
        // Plan mode: reads only, no mutations.
        return this.finish(call, assessment, false, true);

      case 'dontAsk': {
        const allowMatch = this.allowedByRuleOrTransient(call);
        if (allowMatch && !blockedFromAuto) return this.finish(call, assessment, true, true);
        return this.finish(call, assessment, false, true); // never prompts
      }

      case 'acceptEdits': {
        if (!blockedFromAuto && (assessment.risk === 'edit' || isSafeFsCommand(command) || this.allowedByRuleOrTransient(call))) {
          return this.finish(call, assessment, true, true);
        }
        return this.promptDecision(call, tool, assessment);
      }

      case 'auto':
        return this.autoDecide(call, tool, assessment);

      case 'default':
      default: {
        const allowMatch = this.allowedByRuleOrTransient(call);
        const canAutoAllow = !(this.opts.strictRemote || rules.sandbox);
        if (allowMatch && canAutoAllow && !blockedFromAuto) {
          return this.finish(call, assessment, true, true);
        }
        return this.promptDecision(call, tool, assessment);
      }
    }
  }

  /** auto mode: route through the classifier with fallback to prompting. */
  private async autoDecide(call: ToolCall, tool: Tool<unknown> | undefined, assessment: RiskAssessment): Promise<boolean> {
    if (!this.opts.classifier) {
      // No classifier configured — behave like default (prompt).
      return this.promptDecision(call, tool, assessment);
    }
    // After repeated blocks, fall back to manual prompting.
    if (this.consecutiveBlocks >= 3 || this.totalBlocks >= 20) {
      return this.promptDecision(call, tool, assessment);
    }
    const verdict = await this.opts.classifier(call, assessment);
    if (verdict.allow) {
      this.consecutiveBlocks = 0;
      return this.finish(call, assessment, true, true);
    }
    this.consecutiveBlocks++;
    this.totalBlocks++;
    if (verdict.reason) assessment.reasons.push(`auto-mode: ${verdict.reason}`);
    return this.finish(call, assessment, false, true);
  }

  private async promptDecision(call: ToolCall, tool: Tool<unknown> | undefined, assessment: RiskAssessment): Promise<boolean> {
    const decision = await this.opts.prompt({
      call,
      tool,
      assessment,
      summary: this.summarize(call, assessment),
    });
    this.audit(call, decision ? 'allowed' : 'denied', assessment);
    return decision;
  }

  /** Record an auto decision and return it. */
  private finish(call: ToolCall, assessment: RiskAssessment, allow: boolean, auto: boolean): boolean {
    this.audit(call, allow ? (auto ? 'auto-allowed' : 'allowed') : auto ? 'auto-denied' : 'denied', assessment);
    return allow;
  }

  /** Build an ApprovalHook bound to this engine for the agent loop. */
  toHook(): (call: ToolCall, tool: Tool<unknown>) => Promise<{ allow: boolean; reason?: string }> {
    return async (call, tool) => {
      const allow = await this.decide(call, tool);
      if (!allow) {
        if (this.mode === 'plan') {
          return { allow, reason: 'plan mode is read-only — switch with Shift+Tab or /mode default' };
        }
        if (this.mode === 'dontAsk') return { allow, reason: 'dontAsk mode — only pre-approved tools run' };
      }
      return { allow };
    };
  }

  private summarize(call: ToolCall, a: RiskAssessment): string {
    const tag = a.destructive
      ? c.red('⚠ destructive ')
      : a.protected
        ? c.yellow('⚠ protected ')
        : a.secret
          ? c.yellow('⚠ secret ')
          : '';
    const detail = a.reasons.length ? c.dim(` (${a.reasons.join('; ')})`) : '';
    return `${tag}${describeCall(call)}${detail}`;
  }

  private audit(call: ToolCall, decision: 'allowed' | 'denied' | 'auto-allowed' | 'auto-denied', a: RiskAssessment): void {
    this.opts.audit?.record({
      timestamp: new Date().toISOString(),
      tool: call.name,
      input: call.input,
      decision,
      risk: a.risk,
      reasons: a.reasons,
      origin: this.opts.origin,
    });
  }
}
