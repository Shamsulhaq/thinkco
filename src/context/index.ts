/** Lightweight file indexing + keyword relevance retrieval (no embeddings dependency). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from '../tools/glob.js';

export interface IndexedFile {
  path: string;
  /** Lowercased token set for keyword scoring. */
  tokens: Set<string>;
  /** First lines preview. */
  preview: string;
}

const TOKEN_RE = /[a-zA-Z0-9_]{2,}/g;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).slice(0, 2000);
}

export interface BuildIndexOptions {
  root: string;
  match?: string;
  limit?: number;
  maxFileBytes?: number;
}

/** Build an in-memory index over project files. */
export function buildIndex(opts: BuildIndexOptions): IndexedFile[] {
  const files = walkFiles({ root: opts.root, match: opts.match, limit: opts.limit ?? 2000 });
  const index: IndexedFile[] = [];
  for (const rel of files) {
    try {
      const content = readFileSync(join(opts.root, rel), 'utf8').slice(0, opts.maxFileBytes ?? 20_000);
      index.push({
        path: rel,
        tokens: new Set([...tokenize(rel), ...tokenize(content)]),
        preview: content.split('\n').slice(0, 5).join('\n'),
      });
    } catch {
      // skip unreadable/binary files
    }
  }
  return index;
}

export interface RetrievalResult {
  path: string;
  score: number;
  preview: string;
}

/** Retrieve the most relevant files for a query by token overlap. */
export function retrieveRelevant(query: string, index: IndexedFile[], limit = 5): RetrievalResult[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];
  const scored = index.map((f) => {
    let score = 0;
    for (const t of queryTokens) if (f.tokens.has(t)) score++;
    // Boost path matches.
    for (const t of queryTokens) if (f.path.toLowerCase().includes(t)) score += 2;
    return { path: f.path, score, preview: f.preview };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
