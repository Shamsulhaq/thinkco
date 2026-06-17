/** Helpers for a richer, safer tool-approval UX: details, trust scopes, and defaults. */
import type { ToolCall } from '../types/index.js';

export type ApprovalScope = 'once' | 'session' | 'always' | 'deny';

export interface ApprovalOption {
  label: string;
  scope: ApprovalScope;
}

/** The ordered approval choices for a tool, including a session-only trust scope. */
export function approvalScopeOptions(toolName: string): ApprovalOption[] {
  return [
    { label: 'Yes (this time)', scope: 'once' },
    { label: 'Yes, for the rest of this session', scope: 'session' },
    { label: `Always allow "${toolName}"`, scope: 'always' },
    { label: 'No (deny)', scope: 'deny' },
  ];
}

/** True when a risk level should default the cursor to "deny" (safer confirm flow). */
export function isDangerous(risk: string | undefined): boolean {
  return risk === 'execute' || risk === 'write' || risk === 'delete' || risk === 'network';
}

/** Default highlighted option index: deny for dangerous actions, otherwise "yes once". */
export function defaultApprovalIndex(risk: string | undefined, optionCount = 4): number {
  return isDangerous(risk) ? optionCount - 1 : 0;
}

/** A concise, human-readable description of what a tool call will do (for the details pane). */
export function describeToolCall(call: ToolCall): string {
  const i = call.input ?? {};
  const pick = (k: string): string | undefined => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
  const detail =
    pick('command') ??
    pick('path') ??
    pick('file_path') ??
    pick('pattern') ??
    pick('url') ??
    pick('query');
  const head = `${call.name}${detail ? `: ${detail}` : ''}`;
  // Append a compact dump of any remaining scalar args.
  const extras = Object.entries(i)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join('  ');
  return extras ? `${head}\n  ${extras}` : head;
}
