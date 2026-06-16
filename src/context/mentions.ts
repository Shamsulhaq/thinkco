/** @file mention expansion: inline referenced file contents into a user message. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

/** Matches @path tokens: @src/file.ts, @./a.md, @/abs/path. Stops at whitespace. */
const MENTION_RE = /(^|\s)@([^\s@]+)/g;

export interface ExpandResult {
  text: string;
  files: string[];
}

/** Replace @file mentions with their contents appended as fenced blocks. */
export function expandMentions(input: string, cwd: string, maxBytes = 50_000): ExpandResult {
  const files: string[] = [];
  const blocks: string[] = [];

  for (const match of input.matchAll(MENTION_RE)) {
    const rel = match[2]!;
    const full = isAbsolute(rel) ? rel : resolve(cwd, rel);
    if (!existsSync(full)) continue;
    try {
      if (!statSync(full).isFile()) continue;
      const content = readFileSync(full, 'utf8').slice(0, maxBytes);
      files.push(rel);
      blocks.push(`\n\n--- ${rel} ---\n${content}`);
    } catch {
      // ignore
    }
  }

  if (!blocks.length) return { text: input, files: [] };
  return { text: `${input}${blocks.join('')}`, files };
}
