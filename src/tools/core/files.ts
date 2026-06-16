/** File tools: read, write, edit, list. */
import { z } from 'zod';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import type { Tool, ToolContext } from '../types.js';

function resolvePath(ctx: ToolContext, p: string): string {
  return isAbsolute(p) ? p : resolve(ctx.cwd, p);
}

/** A compact +/- diff snippet (capped) for display and model feedback. */
function diffSnippet(oldStr: string, newStr: string, maxLines = 16): string {
  const cap = (s: string): string[] => {
    const lines = s.split('\n');
    return lines.length > maxLines ? [...lines.slice(0, maxLines), '…'] : lines;
  };
  const minus = cap(oldStr).map((l) => `- ${l}`);
  const plus = cap(newStr).map((l) => `+ ${l}`);
  return [...minus, ...plus].join('\n');
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ');

/** Normalized Levenshtein similarity ratio (0..1). Capped for performance. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length > 400 || b.length > 400) return a === b ? 1 : 0;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const dist = prev[n]!;
  return 1 - dist / Math.max(m, n);
}

/** Find the best-matching block in `content` for `oldString`. Returns indices + score. */
function fuzzyFindBlock(
  content: string,
  oldString: string,
): { start: number; end: number; score: number; ambiguous: boolean } | null {
  const fileLines = content.split('\n');
  const oldLines = oldString.split('\n');
  const n = oldLines.length;
  if (n === 0 || n > fileLines.length) return null;

  const target = oldLines.map(norm);
  let best = -1;
  let bestStart = -1;
  let secondBest = -1;
  for (let i = 0; i + n <= fileLines.length; i++) {
    let score = 0;
    for (let k = 0; k < n; k++) {
      const fl = norm(fileLines[i + k]!);
      score += fl === target[k] ? 1 : similarity(fl, target[k]!);
    }
    score /= n;
    if (score > best) {
      secondBest = best;
      best = score;
      bestStart = i;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }
  if (bestStart < 0) return null;
  return { start: bestStart, end: bestStart + n, score: best, ambiguous: best - secondBest < 0.05 };
}

export const readFileTool: Tool<{ path: string; offset?: number; limit?: number }> = {
  name: 'read',
  description: 'Read a text file. Optionally specify a 1-based line offset and a line limit.',
  risk: 'read',
  schema: z.object({
    path: z.string().describe('File path (relative to cwd or absolute)'),
    offset: z.number().int().positive().optional().describe('1-based start line'),
    limit: z.number().int().positive().optional().describe('Max lines to read'),
  }),
  run: async (input, ctx) => {
    const full = resolvePath(ctx, input.path);
    if (!existsSync(full)) throw new Error(`File not found: ${input.path}`);
    const content = readFileSync(full, 'utf8');
    if (input.offset === undefined && input.limit === undefined) {
      // Cap very large default reads to protect the context window.
      const MAX = 2000;
      const lines = content.split('\n');
      if (lines.length > MAX) {
        return (
          `${lines.slice(0, MAX).join('\n')}\n` +
          `…(truncated: showing ${MAX} of ${lines.length} lines — use offset/limit to read more)`
        );
      }
      return content;
    }
    const lines = content.split('\n');
    const start = (input.offset ?? 1) - 1;
    const end = input.limit ? start + input.limit : lines.length;
    return lines.slice(start, end).join('\n');
  },
};

export const writeFileTool: Tool<{ path: string; content: string }> = {
  name: 'write',
  description: 'Write content to a file, creating parent directories. Overwrites existing files.',
  risk: 'edit',
  schema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  run: async (input, ctx) => {
    const full = resolvePath(ctx, input.path);
    const existed = existsSync(full);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, input.content);
    const lineCount = input.content.split('\n').length;
    if (existed) {
      return `Overwrote ${input.path} (${input.content.length} bytes, ${lineCount} lines)`;
    }
    const preview = input.content.split('\n').slice(0, 16).map((l) => `+ ${l}`).join('\n');
    return `Created ${input.path} (${lineCount} lines)\n${preview}`;
  },
};

export const editFileTool: Tool<{
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}> = {
  name: 'edit',
  description:
    'Replace a string in a file. Tries an exact match first, then tolerates whitespace/indentation differences. Use replaceAll for multiple matches.',
  risk: 'edit',
  schema: z.object({
    path: z.string(),
    oldString: z.string().describe('Exact text to find'),
    newString: z.string().describe('Replacement text'),
    replaceAll: z.boolean().optional(),
  }),
  run: async (input, ctx) => {
    const full = resolvePath(ctx, input.path);
    if (!existsSync(full)) throw new Error(`File not found: ${input.path}`);
    const content = readFileSync(full, 'utf8');

    // 1. Exact match.
    const exact = content.split(input.oldString).length - 1;
    if (exact > 0) {
      if (exact > 1 && !input.replaceAll) {
        throw new Error(
          `oldString matches ${exact} places; pass replaceAll:true or include more surrounding context to make it unique.`,
        );
      }
      const updated = input.replaceAll
        ? content.split(input.oldString).join(input.newString)
        : content.replace(input.oldString, input.newString);
      writeFileSync(full, updated);
      return `Replaced ${input.replaceAll ? exact : 1} occurrence(s) in ${input.path}\n${diffSnippet(input.oldString, input.newString)}`;
    }

    // 2. Whitespace-tolerant fallback: match ignoring differences in indentation/line breaks.
    const flexible = new RegExp(
      input.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
      'g',
    );
    const matches = content.match(flexible);
    if (matches && matches.length > 0) {
      if (matches.length > 1 && !input.replaceAll) {
        throw new Error(
          `oldString matches ${matches.length} places (ignoring whitespace); pass replaceAll:true or add more context.`,
        );
      }
      let done = false;
      const updated = content.replace(flexible, () => {
        if (input.replaceAll) return input.newString;
        if (done) return matches[0]!;
        done = true;
        return input.newString;
      });
      writeFileSync(full, updated);
      return `Replaced ${input.replaceAll ? matches.length : 1} occurrence(s) in ${input.path} (matched ignoring whitespace)`;
    }

    // 3. Fuzzy match: locate the closest block and apply when confidently similar.
    const fuzzy = fuzzyFindBlock(content, input.oldString);
    if (fuzzy && fuzzy.score >= 0.8 && !fuzzy.ambiguous) {
      const lines = content.split('\n');
      const updated = [...lines.slice(0, fuzzy.start), input.newString, ...lines.slice(fuzzy.end)].join('\n');
      writeFileSync(full, updated);
      const pct = Math.round(fuzzy.score * 100);
      return `Replaced 1 occurrence(s) in ${input.path} (fuzzy match, ~${pct}% similar)\n${diffSnippet(input.oldString, input.newString)}`;
    }

    // 4. Not found — give the model the actual content so it can correct in one shot.
    const fileLines = content.split('\n');
    const shown =
      fileLines.length > 160 ? `${fileLines.slice(0, 160).join('\n')}\n…(truncated)` : content;
    throw new Error(
      `oldString not found in ${input.path}. Current file content follows — copy exact text for "edit", ` +
        `or use the "write" tool to replace the whole file:\n\n${shown}`,
    );
  },
};

export const listDirTool: Tool<{ path?: string }> = {
  name: 'list',
  description: 'List the entries of a directory (non-recursive).',
  risk: 'read',
  schema: z.object({ path: z.string().optional() }),
  run: async (input, ctx) => {
    const full = resolvePath(ctx, input.path ?? '.');
    if (!existsSync(full)) throw new Error(`Directory not found: ${input.path ?? '.'}`);
    const entries = readdirSync(full).map((e) => {
      const st = statSync(join(full, e));
      return st.isDirectory() ? `${e}/` : e;
    });
    return entries.sort().join('\n') || '(empty)';
  },
};

export const fileTools = [readFileTool, writeFileTool, editFileTool, listDirTool];
