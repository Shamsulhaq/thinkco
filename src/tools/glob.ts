/** Minimal glob matching + directory walking with default + .gitignore-style ignores. */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_IGNORES = ['node_modules', '.git', 'dist', 'build', 'coverage', '.cache'];

/** Convert a glob pattern to a RegExp. Supports **, *, ?, and character classes. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** matches across path separators
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('+.^$()|{}[]\\'.includes(c)) {
      re += '\\' + c;
    } else if (c === '/') {
      re += '/';
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path.split(sep).join('/'));
}

/** Read simple .gitignore patterns (bare names / globs). Comments and negations ignored. */
function readGitignore(root: string): string[] {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => l.replace(/\/$/, ''));
}

export interface WalkOptions {
  root: string;
  maxDepth?: number;
  respectGitignore?: boolean;
  /** Only return files matching this glob (relative to root). */
  match?: string;
  limit?: number;
}

/** Recursively walk a directory, returning relative file paths. */
export function walkFiles(opts: WalkOptions): string[] {
  const { root } = opts;
  const maxDepth = opts.maxDepth ?? 50;
  const ignores = new Set(DEFAULT_IGNORES);
  if (opts.respectGitignore !== false) {
    for (const p of readGitignore(root)) ignores.add(p);
  }
  const limit = opts.limit ?? 10000;
  const results: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || results.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignores.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else {
        const rel = relative(root, full).split(sep).join('/');
        if (!opts.match || matchGlob(opts.match, rel)) {
          results.push(rel);
          if (results.length >= limit) return;
        }
      }
    }
  };

  walk(root, 0);
  return results;
}
