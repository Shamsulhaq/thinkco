/** Input foundation for the TUI: command history, @-path completion, and multiline helpers. */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

/** A bounded, navigable command-input history with reverse search. */
export class CommandHistory {
  private readonly items: string[] = [];
  private cursor = -1; // -1 = not navigating (at the "new line")
  private draft = '';

  constructor(private readonly max = 200) {}

  get entries(): readonly string[] {
    return this.items;
  }

  /** Record a submitted line (ignoring blanks and consecutive duplicates). */
  add(line: string): void {
    const t = line.trim();
    if (!t) return;
    if (this.items[this.items.length - 1] === t) {
      this.cursor = -1;
      return;
    }
    this.items.push(t);
    if (this.items.length > this.max) this.items.shift();
    this.cursor = -1;
  }

  /** Navigate to the previous (older) entry. `current` seeds the draft on first press. */
  prev(current = ''): string | undefined {
    if (this.items.length === 0) return undefined;
    if (this.cursor === -1) {
      this.draft = current;
      this.cursor = this.items.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    }
    return this.items[this.cursor];
  }

  /** Navigate to the next (newer) entry; returns the saved draft past the newest. */
  next(): string | undefined {
    if (this.cursor === -1) return undefined;
    if (this.cursor < this.items.length - 1) {
      this.cursor++;
      return this.items[this.cursor];
    }
    this.cursor = -1;
    return this.draft;
  }

  /** Reset navigation (e.g. after a submit or edit). */
  reset(): void {
    this.cursor = -1;
  }

  /** Most recent entry matching a query (reverse search). */
  search(query: string): string | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i]!.toLowerCase().includes(q)) return this.items[i];
    }
    return undefined;
  }
}

/** Detect a trailing `@<partial>` token at the cursor (end of input) for path completion. */
export function detectAtMention(text: string): { prefix: string; start: number } | undefined {
  const m = /(^|\s)@([^\s]*)$/.exec(text);
  if (!m) return undefined;
  return { prefix: m[2] ?? '', start: text.length - (m[2] ?? '').length };
}

/** Complete a path prefix against the filesystem (for the @file picker). Returns up to `limit`. */
export function pathCompletions(prefix: string, cwd: string, limit = 10): string[] {
  const rel = prefix || '';
  const endsSlash = rel.endsWith('/');
  const dir = endsSlash ? rel.slice(0, -1) || '.' : rel.includes('/') ? dirname(rel) : '.';
  const base = endsSlash ? '' : rel.includes('/') ? basename(rel) : rel;
  const absDir = join(cwd, dir);
  if (!existsSync(absDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.toLowerCase().startsWith(base.toLowerCase()) && !e.startsWith('.'))
    .slice(0, limit)
    .map((e) => {
      const full = dir === '.' ? e : `${dir}/${e}`;
      try {
        return statSync(join(cwd, full)).isDirectory() ? `${full}/` : full;
      } catch {
        return full;
      }
    })
    .sort();
}

/**
 * Decide whether an Enter keypress submits or inserts a newline. Shift+Enter (or a trailing
 * backslash) inserts a newline for multi-line input; a plain Enter submits.
 */
export function shouldSubmitOnEnter(value: string, shift: boolean): boolean {
  if (shift) return false;
  if (value.endsWith('\\')) return false;
  return true;
}
