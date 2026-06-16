/** Redact likely secrets from text before sending over a remote transport. */

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[a-zA-Z0-9]{16,}/g, label: '[redacted-openai-key]' },
  { re: /sk-ant-[a-zA-Z0-9_-]{16,}/g, label: '[redacted-anthropic-key]' },
  { re: /ghp_[a-zA-Z0-9]{20,}/g, label: '[redacted-github-token]' },
  { re: /xox[baprs]-[a-zA-Z0-9-]{10,}/g, label: '[redacted-slack-token]' },
  { re: /AKIA[0-9A-Z]{16}/g, label: '[redacted-aws-key]' },
  { re: /\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b/g, label: '[redacted-telegram-token]' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: '[redacted-private-key]' },
];

/** Replace known secret patterns with placeholders. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, label } of PATTERNS) out = out.replace(re, label);
  return out;
}
