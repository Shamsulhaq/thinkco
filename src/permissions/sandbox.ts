/** Sandbox guard: block dangerous/network/privilege shell commands when sandbox mode is on. */

const DENY: Array<{ re: RegExp; why: string }> = [
  { re: /\bsudo\b|\bdoas\b|\bsu\b/, why: 'privilege escalation' },
  { re: /\bcurl\b|\bwget\b|\bncat\b|\bnc\b|\bssh\b|\bscp\b|\btelnet\b|\bftp\b/, why: 'network egress' },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b|\bmkfs\b|\bdd\s+if=/, why: 'destructive system command' },
  { re: /\bchmod\s+(-R\s+)?777\b/, why: 'unsafe permissions' },
  { re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+([/~]|\*)/, why: 'recursive delete of a root/home path' },
  { re: /:\s*\(\s*\)\s*\{/, why: 'fork bomb' },
  { re: /\bgit\s+push\b/, why: 'remote push' },
];

export interface SandboxVerdict {
  ok: boolean;
  reason?: string;
}

/** Returns {ok:false, reason} if a command is disallowed under sandbox mode. */
export function sandboxGuard(command: string): SandboxVerdict {
  for (const { re, why } of DENY) {
    if (re.test(command)) return { ok: false, reason: `sandbox blocked (${why})` };
  }
  return { ok: true };
}
