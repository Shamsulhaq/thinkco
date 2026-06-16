/** Risk classification for tool calls: detects destructive commands and secret-file access. */
import type { ToolCall } from '../types/index.js';
import type { RiskLevel, Tool } from '../tools/types.js';

export interface RiskAssessment {
  risk: RiskLevel;
  /** True if the action is potentially destructive/irreversible. */
  destructive: boolean;
  /** True if the action touches likely-secret files. */
  secret: boolean;
  /** True if the action writes to a protected path (repo/tool state). */
  protected: boolean;
  reasons: string[];
}

/** Destructive shell-command signatures (regex). */
const DESTRUCTIVE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, why: 'recursive force remove (rm -rf)' },
  { re: /\brm\s+-[a-z]*r\b/i, why: 'recursive remove' },
  { re: /\bgit\s+push\s+.*--force\b/i, why: 'git force push' },
  { re: /\bgit\s+push\s+.*-f\b/i, why: 'git force push' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'git hard reset' },
  { re: /\bgit\s+clean\s+-[a-z]*f\b/i, why: 'git clean force' },
  { re: /\bgit\s+branch\s+-D\b/, why: 'force delete branch' },
  { re: /\b(mkfs|dd)\b/i, why: 'disk-level operation' },
  { re: /\b(shutdown|reboot|halt)\b/i, why: 'system power operation' },
  { re: />\s*\/dev\/sd[a-z]/i, why: 'write to raw disk' },
  { re: /\bchmod\s+-R\b/i, why: 'recursive permission change' },
  { re: /\bsudo\b/i, why: 'privilege escalation' },
  { re: /\bcurl\b[^|]*\|\s*(sh|bash)\b/i, why: 'pipe remote script to shell' },
  { re: /\b(kill|pkill|killall)\s+-9\b/i, why: 'forced process kill' },
  { re: /:\s*\(\s*\)\s*\{.*\}\s*;/, why: 'possible fork bomb' },
];

/** Filenames/paths that likely contain secrets. */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /(^|\/)credentials$/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
  /secrets?\.(json|ya?ml|toml)$/i,
];

function stringFields(input: Record<string, unknown>): string[] {
  return Object.values(input).filter((v): v is string => typeof v === 'string');
}

export function isSecretPath(path: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(path));
}

/** Paths that must never be auto-approved for writes (repo/tool state). */
const PROTECTED_PATTERNS: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.thinkco(\/|$)/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.vscode(\/|$)/,
  /(^|\/)\.idea(\/|$)/,
  /(^|\/)\.husky(\/|$)/,
  /(^|\/)\.github(\/|$)/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /(^|\/)\.mcp\.json$/,
];

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATTERNS.some((re) => re.test(path));
}

/** rm -rf / and rm -rf ~ style catastrophes — a hard circuit breaker even in bypass. */
const CIRCUIT_BREAKERS: RegExp[] = [
  /\brm\s+-[a-z]*\s*\/(\s|$)/i,
  /\brm\s+-[a-z]*\s*~(\s|$)/i,
  /\brm\s+-[a-z]*\s*\/\*/i,
];

export function isCircuitBreaker(command: string): boolean {
  return CIRCUIT_BREAKERS.some((re) => re.test(command));
}

export function findDestructive(command: string): string | undefined {
  return DESTRUCTIVE_PATTERNS.find((p) => p.re.test(command))?.why;
}

/** A short, human-readable description of what a tool call will do (no giant payloads). */
export function describeCall(call: ToolCall): string {
  const i = call.input;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const path = str(i.path);
  switch (call.name) {
    case 'write': {
      const bytes = typeof i.content === 'string' ? (i.content as string).length : 0;
      return `Write file "${path}" (${bytes} bytes)`;
    }
    case 'edit':
      return `Edit file "${path}"`;
    case 'read':
      return `Read file "${path}"`;
    case 'list':
      return `List directory "${path || '.'}"`;
    case 'glob':
      return `Find files matching "${str(i.pattern)}"`;
    case 'grep':
      return `Search for "${str(i.pattern)}"`;
    case 'shell':
      return `Run command: ${str(i.command)}`;
    case 'git':
      return `Run git ${str(i.subcommand)}${Array.isArray(i.args) ? ' ' + (i.args as string[]).join(' ') : ''}`;
    case 'web_fetch':
      return `Fetch URL: ${str(i.url)}`;
    default: {
      if (call.name.startsWith('mcp__')) return `Run MCP tool "${call.name.replace(/^mcp__/, '')}"`;
      if (call.name.startsWith('skill__')) return `Run skill script "${call.name}"`;
      const json = JSON.stringify(i);
      return `${call.name}(${json.length > 80 ? json.slice(0, 80) + '…' : json})`;
    }
  }
}

/** Classify a tool call's risk. */
export function classifyAction(call: ToolCall, tool?: Tool<unknown>): RiskAssessment {
  const reasons: string[] = [];
  const risk: RiskLevel = tool?.risk ?? 'execute';
  let destructive = false;
  let secret = false;
  let isProtected = false;

  // Destructive shell/git command detection.
  const command = typeof call.input.command === 'string' ? call.input.command : '';
  if (command) {
    const why = findDestructive(command);
    if (why) {
      destructive = true;
      reasons.push(`destructive command: ${why}`);
    }
  }
  if (call.name === 'git') {
    const sub = String(call.input.subcommand ?? '');
    const args = Array.isArray(call.input.args) ? (call.input.args as string[]).join(' ') : '';
    const combined = `git ${sub} ${args}`;
    const why = findDestructive(combined);
    if (why) {
      destructive = true;
      reasons.push(`destructive git: ${why}`);
    }
  }

  // Secret file access.
  for (const value of stringFields(call.input)) {
    if (isSecretPath(value)) {
      secret = true;
      reasons.push(`touches secret-like path: ${value}`);
      break;
    }
  }

  // Protected-path writes (only relevant for mutating tools).
  if (risk === 'edit' || call.name === 'write' || call.name === 'edit') {
    for (const value of stringFields(call.input)) {
      if (isProtectedPath(value)) {
        isProtected = true;
        reasons.push(`writes to protected path: ${value}`);
        break;
      }
    }
  }

  return { risk, destructive, secret, protected: isProtected, reasons };
}
