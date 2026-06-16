/** Multi-language symbol extraction via line patterns (no native dependency). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles, matchGlob } from '../glob.js';
import { astLangKey, type AstGrepModule, type AstNode } from './astgrep.js';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'method'
  | 'constant';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number; // 1-based
  signature: string; // trimmed source line
}

export interface SymbolHit extends CodeSymbol {
  file: string;
}

/** Map a file extension to a language id. */
export function detectLanguage(file: string): string | null {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return null;
  switch (file.slice(dot).toLowerCase()) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.java':
      return 'java';
    case '.rb':
      return 'ruby';
    default:
      return null;
  }
}

interface Pattern {
  kind: SymbolKind;
  re: RegExp;
}

// Words that the loose TS/JS "method" pattern must never capture.
const NON_SYMBOL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'return', 'typeof', 'await',
  'new', 'throw', 'super', 'function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var',
]);

const TS_PATTERNS: Pattern[] = [
  { kind: 'class', re: /\bclass\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'interface', re: /\binterface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', re: /\btype\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
  { kind: 'enum', re: /\benum\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'function', re: /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/ },
  {
    kind: 'function',
    re: /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+?)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  },
  {
    kind: 'method',
    re: /^\s*(?:public|private|protected|readonly|static|async|get|set|override|\*|\s)*([A-Za-z_$][\w$]*)\s*\([^;{]*\)\s*(?::[^={]+?)?\{/,
  },
];

const PY_PATTERNS: Pattern[] = [
  { kind: 'function', re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  { kind: 'class', re: /^\s*class\s+([A-Za-z_]\w*)/ },
];

const GO_PATTERNS: Pattern[] = [
  { kind: 'function', re: /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/ },
  { kind: 'struct', re: /\btype\s+([A-Za-z_]\w*)\s+struct\b/ },
  { kind: 'interface', re: /\btype\s+([A-Za-z_]\w*)\s+interface\b/ },
  { kind: 'type', re: /\btype\s+([A-Za-z_]\w*)\s+\w/ },
];

const RUST_PATTERNS: Pattern[] = [
  { kind: 'function', re: /\bfn\s+([A-Za-z_]\w*)/ },
  { kind: 'struct', re: /\bstruct\s+([A-Za-z_]\w*)/ },
  { kind: 'enum', re: /\benum\s+([A-Za-z_]\w*)/ },
  { kind: 'trait', re: /\btrait\s+([A-Za-z_]\w*)/ },
];

const JAVA_PATTERNS: Pattern[] = [
  { kind: 'class', re: /\b(?:public|private|protected|abstract|final|\s)*class\s+([A-Za-z_]\w*)/ },
  { kind: 'interface', re: /\b(?:public|private|protected|\s)*interface\s+([A-Za-z_]\w*)/ },
  { kind: 'enum', re: /\b(?:public|private|protected|\s)*enum\s+([A-Za-z_]\w*)/ },
];

const RUBY_PATTERNS: Pattern[] = [
  { kind: 'method', re: /^\s*def\s+([A-Za-z_]\w*[?!=]?)/ },
  { kind: 'class', re: /^\s*class\s+([A-Za-z_]\w*)/ },
  { kind: 'interface', re: /^\s*module\s+([A-Za-z_]\w*)/ },
];

const PATTERNS: Record<string, Pattern[]> = {
  typescript: TS_PATTERNS,
  javascript: TS_PATTERNS,
  python: PY_PATTERNS,
  go: GO_PATTERNS,
  rust: RUST_PATTERNS,
  java: JAVA_PATTERNS,
  ruby: RUBY_PATTERNS,
};

/** Languages this extractor understands. */
export function supportedLanguages(): string[] {
  return Object.keys(PATTERNS);
}

/** Extract symbol definitions from source text for a given language. */
export function extractSymbols(content: string, language: string): CodeSymbol[] {
  const patterns = PATTERNS[language];
  if (!patterns) return [];
  const lines = content.split('\n');
  const out: CodeSymbol[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { kind, re } of patterns) {
      const m = re.exec(line);
      const name = m?.[1];
      if (!name || NON_SYMBOL.has(name)) continue;
      const key = `${name}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, kind, line: i + 1, signature: line.trim().slice(0, 200) });
    }
  }
  return out;
}

// ── AST-accurate extraction (via the optional @ast-grep/napi, when available) ──────────────

const FUNCTION_VALUE_KINDS = new Set(['arrow_function', 'function', 'function_expression', 'generator_function']);

// Map a tree-sitter node kind -> SymbolKind, per language family.
const AST_KINDS: Record<string, Record<string, SymbolKind>> = {
  ts: {
    class_declaration: 'class',
    abstract_class_declaration: 'class',
    function_declaration: 'function',
    generator_function_declaration: 'function',
    method_definition: 'method',
    abstract_method_signature: 'method',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'enum',
  },
  py: { class_definition: 'class', function_definition: 'function' },
  go: { function_declaration: 'function', method_declaration: 'method' },
  rust: {
    struct_item: 'struct',
    enum_item: 'enum',
    trait_item: 'trait',
    function_item: 'function',
  },
  java: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
    method_declaration: 'method',
  },
  ruby: { class: 'class', module: 'interface', method: 'method' },
};

function familyForLangKey(langKey: string): keyof typeof AST_KINDS | null {
  switch (langKey) {
    case 'TypeScript':
    case 'Tsx':
    case 'JavaScript':
      return 'ts';
    case 'Python':
      return 'py';
    case 'Go':
      return 'go';
    case 'Rust':
      return 'rust';
    case 'Java':
      return 'java';
    case 'Ruby':
      return 'ruby';
    default:
      return null;
  }
}

function nodeSignature(node: AstNode): string {
  return node.text().split('\n')[0]!.trim().slice(0, 200);
}

/** Extract symbols from source using a loaded ast-grep module (accurate, language-aware). */
export function astExtractSymbols(mod: AstGrepModule, file: string, source: string): CodeSymbol[] {
  const langKey = astLangKey(file);
  if (!langKey) return [];
  const family = familyForLangKey(langKey);
  if (!family) return [];
  const lang = mod.Lang[langKey];
  if (lang === undefined) return [];

  const root = mod.parse(lang, source).root();
  const kindMap = AST_KINDS[family]!;
  const out: CodeSymbol[] = [];
  const seen = new Set<string>();

  const push = (name: string | undefined, kind: SymbolKind, node: AstNode) => {
    if (!name) return;
    const line = node.range().start.line + 1;
    const key = `${name}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, kind, line, signature: nodeSignature(node) });
  };

  for (const [astKind, symKind] of Object.entries(kindMap)) {
    for (const node of root.findAll({ rule: { kind: astKind } })) {
      if (family === 'go' && astKind === 'function_declaration') {
        push(node.field('name')?.text(), 'function', node);
        continue;
      }
      push(node.field('name')?.text(), symKind, node);
    }
  }

  // TS/JS arrow- and function-valued consts: `const f = () => …` / `const f = function …`.
  if (family === 'ts') {
    for (const node of root.findAll({ rule: { kind: 'variable_declarator' } })) {
      const value = node.field('value');
      if (value && FUNCTION_VALUE_KINDS.has(value.kind())) {
        push(node.field('name')?.text(), 'function', node);
      }
    }
  }

  // Go struct/interface type specs.
  if (family === 'go') {
    for (const node of root.findAll({ rule: { kind: 'type_spec' } })) {
      const t = node.field('type');
      const kind: SymbolKind = t?.kind() === 'struct_type' ? 'struct' : t?.kind() === 'interface_type' ? 'interface' : 'type';
      push(node.field('name')?.text(), kind, node);
    }
  }

  return out;
}

function fuzzyMatch(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.includes(q)) return true;
  // subsequence match: all chars of q appear in order in n
  let j = 0;
  for (let i = 0; i < n.length && j < q.length; i++) {
    if (n[i] === q[j]) j++;
  }
  return j === q.length;
}

export interface SearchSymbolsOptions {
  /** Restrict to files matching this glob (relative to root). */
  include?: string;
  /** Restrict to a single symbol kind. */
  kind?: SymbolKind;
  limit?: number;
  /** When provided, extract symbols with the AST instead of regex (more accurate). */
  astMod?: AstGrepModule | null;
}

/** Extract symbols from a file's content, preferring the AST when an ast-grep module is given. */
function extractForFile(file: string, content: string, astMod?: AstGrepModule | null): CodeSymbol[] {
  if (astMod) {
    try {
      const ast = astExtractSymbols(astMod, file, content);
      if (ast.length) return ast;
    } catch {
      // fall through to regex on any AST error
    }
  }
  const language = detectLanguage(file);
  return language ? extractSymbols(content, language) : [];
}

/** Search symbol definitions across a directory tree by (fuzzy) name. */
export function searchSymbols(root: string, query: string, opts: SearchSymbolsOptions = {}): SymbolHit[] {
  const files = walkFiles({ root, limit: 8000 });
  const limit = opts.limit ?? 100;
  const hits: SymbolHit[] = [];
  for (const rel of files) {
    if (opts.include && !matchGlob(opts.include, rel)) continue;
    const language = detectLanguage(rel);
    if (!language) continue;
    let content: string;
    try {
      content = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const sym of extractForFile(rel, content, opts.astMod)) {
      if (opts.kind && sym.kind !== opts.kind) continue;
      if (!fuzzyMatch(sym.name, query)) continue;
      hits.push({ ...sym, file: rel });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** List all symbols in a single file's content (AST-accurate when an ast-grep module is given). */
export function documentSymbols(file: string, content: string, astMod?: AstGrepModule | null): CodeSymbol[] {
  return extractForFile(file, content, astMod);
}
