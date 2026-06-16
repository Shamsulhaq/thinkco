/** Codebase overview: language breakdown, directory map, and symbol counts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from '../glob.js';
import { detectLanguage, extractSymbols } from './symbols.js';

export interface CodebaseOverview {
  totalFiles: number;
  byLanguage: Record<string, number>;
  topDirectories: Array<{ dir: string; files: number }>;
  totalSymbols: number;
}

/** Summarize a codebase: file counts by language, busiest directories, symbol totals. */
export function codebaseOverview(root: string): CodebaseOverview {
  const files = walkFiles({ root, limit: 20000 });
  const byLanguage: Record<string, number> = {};
  const byDir: Record<string, number> = {};
  let totalSymbols = 0;

  for (const rel of files) {
    const slash = rel.indexOf('/');
    const top = slash === -1 ? '.' : rel.slice(0, slash);
    byDir[top] = (byDir[top] ?? 0) + 1;

    const language = detectLanguage(rel);
    if (!language) continue;
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    try {
      totalSymbols += extractSymbols(readFileSync(join(root, rel), 'utf8'), language).length;
    } catch {
      // unreadable file; skip
    }
  }

  const topDirectories = Object.entries(byDir)
    .map(([dir, count]) => ({ dir, files: count }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 15);

  return { totalFiles: files.length, byLanguage, topDirectories, totalSymbols };
}

/** Render an overview as a compact text report. */
export function renderOverview(o: CodebaseOverview): string {
  const langs = Object.entries(o.byLanguage)
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `  ${l}: ${n}`)
    .join('\n');
  const dirs = o.topDirectories.map((d) => `  ${d.dir}/ (${d.files})`).join('\n');
  return [
    `Files: ${o.totalFiles}`,
    `Symbols (approx): ${o.totalSymbols}`,
    langs ? `Languages:\n${langs}` : 'Languages: (none detected)',
    dirs ? `Top directories:\n${dirs}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A focused directory listing with per-directory file counts (for search_codebase_map). */
export function searchCodebaseMap(root: string, subdir?: string): string {
  const files = walkFiles({ root: subdir ? join(root, subdir) : root, limit: 20000 });
  if (files.length === 0) return '(no files)';
  const byDir: Record<string, number> = {};
  for (const rel of files) {
    const slash = rel.lastIndexOf('/');
    const dir = slash === -1 ? '.' : rel.slice(0, slash);
    byDir[dir] = (byDir[dir] ?? 0) + 1;
  }
  return Object.entries(byDir)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, count]) => `${subdir ? `${subdir}/` : ''}${dir} — ${count} file(s)`)
    .join('\n');
}
