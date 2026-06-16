/** Optional structural search/rewrite via @ast-grep/napi (lazy-loaded, degrades gracefully). */

// Minimal structural types for the optional dependency.
export interface AstNode {
  kind(): string;
  text(): string;
  range(): { start: { line: number; column: number } };
  field(name: string): AstNode | null;
  replace(text: string): unknown;
}
export interface AstRoot {
  findAll(matcher: string | { rule: { kind: string } }): AstNode[];
  commitEdits(edits: unknown[]): string;
}
interface AstParsed {
  root(): AstRoot;
}
export interface AstGrepModule {
  parse(lang: unknown, src: string): AstParsed;
  Lang: Record<string, unknown>;
}

export const ASTGREP_INSTALL_HINT =
  'pattern_search/pattern_rewrite require @ast-grep/napi. Install it with `npm i @ast-grep/napi`.';

/** Lazily load @ast-grep/napi; returns null if not installed. */
export async function loadAstGrep(): Promise<AstGrepModule | null> {
  try {
    const spec = '@ast-grep/napi';
    return (await import(spec)) as AstGrepModule;
  } catch {
    return null;
  }
}

/** Map a file extension to an ast-grep Lang enum key. */
export function astLangKey(file: string): string | null {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return null;
  switch (file.slice(dot).toLowerCase()) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'TypeScript';
    case '.tsx':
      return 'Tsx';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'JavaScript';
    case '.py':
      return 'Python';
    case '.go':
      return 'Go';
    case '.rs':
      return 'Rust';
    case '.java':
      return 'Java';
    case '.rb':
      return 'Ruby';
    case '.c':
    case '.h':
      return 'C';
    case '.cpp':
    case '.cc':
    case '.hpp':
      return 'Cpp';
    default:
      return null;
  }
}

export interface PatternMatch {
  line: number;
  text: string;
}

/** Find all structural matches of `pattern` in `source` for the given Lang key. */
export function runPatternSearch(
  mod: AstGrepModule,
  langKey: string,
  source: string,
  pattern: string,
): PatternMatch[] {
  const lang = mod.Lang[langKey];
  if (lang === undefined) throw new Error(`Unsupported ast-grep language: ${langKey}`);
  const root = mod.parse(lang, source).root();
  return root.findAll(pattern).map((n) => ({
    line: n.range().start.line + 1,
    text: n.text().split('\n')[0]!.slice(0, 200),
  }));
}

export interface RewriteResult {
  count: number;
  output: string;
}

/** Rewrite all matches of `pattern` with `replacement`; returns the new source and match count. */
export function runPatternRewrite(
  mod: AstGrepModule,
  langKey: string,
  source: string,
  pattern: string,
  replacement: string,
): RewriteResult {
  const lang = mod.Lang[langKey];
  if (lang === undefined) throw new Error(`Unsupported ast-grep language: ${langKey}`);
  const root = mod.parse(lang, source).root();
  const matches = root.findAll(pattern);
  if (matches.length === 0) return { count: 0, output: source };
  const edits = matches.map((n) => n.replace(replacement));
  return { count: matches.length, output: root.commitEdits(edits) };
}
