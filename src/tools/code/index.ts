/** `code` tool: AST/symbol intelligence (search, document symbols, overview, structural rewrite). */
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { walkFiles, matchGlob } from '../glob.js';
import {
  searchSymbols,
  documentSymbols,
  detectLanguage,
  supportedLanguages,
  type SymbolKind,
} from './symbols.js';
import { codebaseOverview, renderOverview, searchCodebaseMap } from './overview.js';
import {
  loadAstGrep,
  astLangKey,
  runPatternSearch,
  runPatternRewrite,
  ASTGREP_INSTALL_HINT,
} from './astgrep.js';

const schema = z.object({
  operation: z
    .enum([
      'search_symbols',
      'lookup_symbols',
      'get_document_symbols',
      'pattern_search',
      'pattern_rewrite',
      'generate_codebase_overview',
      'search_codebase_map',
    ])
    .describe('Which code-intelligence operation to run'),
  symbol_name: z.string().optional().describe('Symbol name to search for (search_symbols)'),
  symbols: z.array(z.string()).optional().describe('Symbol names to look up (lookup_symbols)'),
  file_path: z.string().optional().describe('Target file (get_document_symbols, pattern_*)'),
  path: z.string().optional().describe('Root/sub directory (defaults to cwd)'),
  pattern: z.string().optional().describe('AST pattern (pattern_search/pattern_rewrite)'),
  replacement: z.string().optional().describe('Replacement pattern (pattern_rewrite)'),
  include: z.string().optional().describe('Glob to restrict files, e.g. "src/**/*.ts"'),
  kind: z.string().optional().describe('Restrict to a symbol kind (function, class, ...)'),
  limit: z.number().int().positive().optional(),
  include_source: z.boolean().optional().describe('Include the source line (lookup_symbols)'),
  dry_run: z.boolean().optional().describe('Preview rewrite without writing (default true)'),
});

type CodeInput = z.infer<typeof schema>;

function resolveRoot(ctx: ToolContext, p?: string): string {
  if (!p) return ctx.cwd;
  return isAbsolute(p) ? p : resolve(ctx.cwd, p);
}

function fmtHit(h: { file: string; line: number; kind: string; name: string; signature: string }): string {
  return `${h.file}:${h.line}  ${h.kind} ${h.name}\n    ${h.signature}`;
}

async function patternSearch(input: CodeInput, ctx: ToolContext): Promise<string> {
  if (!input.pattern) throw new Error('pattern_search requires "pattern"');
  const mod = await loadAstGrep();
  if (!mod) return ASTGREP_INSTALL_HINT;

  if (input.file_path) {
    const langKey = astLangKey(input.file_path);
    if (!langKey) return `Unsupported file type for pattern_search: ${input.file_path}`;
    const src = readFileSync(resolveRoot(ctx, input.file_path), 'utf8');
    const matches = runPatternSearch(mod, langKey, src, input.pattern);
    return matches.length
      ? matches.map((m) => `${input.file_path}:${m.line}  ${m.text}`).join('\n')
      : '(no matches)';
  }

  const root = resolveRoot(ctx, input.path);
  const files = walkFiles({ root, limit: 5000 });
  const out: string[] = [];
  const limit = input.limit ?? 200;
  for (const rel of files) {
    if (input.include && !matchGlob(input.include, rel)) continue;
    const langKey = astLangKey(rel);
    if (!langKey) continue;
    let src: string;
    try {
      src = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    let matches;
    try {
      matches = runPatternSearch(mod, langKey, src, input.pattern);
    } catch {
      continue; // pattern invalid for this language
    }
    for (const m of matches) {
      out.push(`${rel}:${m.line}  ${m.text}`);
      if (out.length >= limit) return out.join('\n');
    }
  }
  return out.length ? out.join('\n') : '(no matches)';
}

async function patternRewrite(input: CodeInput, ctx: ToolContext): Promise<string> {
  if (!input.pattern || input.replacement === undefined) {
    throw new Error('pattern_rewrite requires "pattern" and "replacement"');
  }
  if (!input.file_path) throw new Error('pattern_rewrite requires "file_path"');
  const mod = await loadAstGrep();
  if (!mod) return ASTGREP_INSTALL_HINT;
  const langKey = astLangKey(input.file_path);
  if (!langKey) return `Unsupported file type for pattern_rewrite: ${input.file_path}`;

  const abs = resolveRoot(ctx, input.file_path);
  const src = readFileSync(abs, 'utf8');
  const { count, output } = runPatternRewrite(mod, langKey, src, input.pattern, input.replacement);
  if (count === 0) return '(no matches; nothing rewritten)';

  const dryRun = input.dry_run !== false; // default true
  if (dryRun) {
    return `Would rewrite ${count} match(es) in ${input.file_path} (dry run). Preview:\n${output.slice(0, 2000)}`;
  }
  writeFileSync(abs, output, 'utf8');
  return `Rewrote ${count} match(es) in ${input.file_path}.`;
}

export const codeTool: Tool<CodeInput> = {
  name: 'code',
  description:
    'Code intelligence: search_symbols, lookup_symbols, get_document_symbols, ' +
    'generate_codebase_overview, search_codebase_map (no deps); pattern_search/pattern_rewrite ' +
    '(structural, via optional @ast-grep/napi). Language is auto-detected from file extension.',
  risk: 'edit', // pattern_rewrite can modify files, so approval is required by default
  schema,
  run: async (input, ctx) => {
    switch (input.operation) {
      case 'search_symbols': {
        if (!input.symbol_name) throw new Error('search_symbols requires "symbol_name"');
        const astMod = await loadAstGrep();
        const hits = searchSymbols(resolveRoot(ctx, input.path), input.symbol_name, {
          include: input.include,
          kind: input.kind as SymbolKind | undefined,
          limit: input.limit,
          astMod,
        });
        return hits.length ? hits.map(fmtHit).join('\n') : `(no symbols matching "${input.symbol_name}")`;
      }
      case 'lookup_symbols': {
        if (!input.symbols?.length) throw new Error('lookup_symbols requires "symbols"');
        const root = resolveRoot(ctx, input.path);
        const astMod = await loadAstGrep();
        const out: string[] = [];
        for (const name of input.symbols) {
          const exact = searchSymbols(root, name, { include: input.include, limit: 50, astMod }).filter(
            (h) => h.name === name,
          );
          if (exact.length === 0) {
            out.push(`${name}: (not found)`);
          } else {
            for (const h of exact) out.push(input.include_source ? fmtHit(h) : `${name}: ${h.file}:${h.line} (${h.kind})`);
          }
        }
        return out.join('\n');
      }
      case 'get_document_symbols': {
        if (!input.file_path) throw new Error('get_document_symbols requires "file_path"');
        const abs = resolveRoot(ctx, input.file_path);
        const lang = detectLanguage(input.file_path);
        if (!lang) return `Unsupported file type (supported: ${supportedLanguages().join(', ')}).`;
        const astMod = await loadAstGrep();
        const syms = documentSymbols(input.file_path, readFileSync(abs, 'utf8'), astMod);
        return syms.length
          ? syms.map((s) => `${s.line}\t${s.kind}\t${s.name}`).join('\n')
          : '(no symbols found)';
      }
      case 'pattern_search':
        return patternSearch(input, ctx);
      case 'pattern_rewrite':
        return patternRewrite(input, ctx);
      case 'generate_codebase_overview':
        return renderOverview(codebaseOverview(resolveRoot(ctx, input.path)));
      case 'search_codebase_map':
        return searchCodebaseMap(ctx.cwd, input.path);
    }
  },
};
