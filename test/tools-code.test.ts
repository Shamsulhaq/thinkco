import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectLanguage,
  extractSymbols,
  searchSymbols,
  documentSymbols,
} from '../src/tools/code/symbols.js';
import { codebaseOverview, renderOverview, searchCodebaseMap } from '../src/tools/code/overview.js';
import { astLangKey, loadAstGrep } from '../src/tools/code/astgrep.js';
import { codeTool } from '../src/tools/code/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-code-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const TS = `export class Widget {
  private count = 0;
  increment(by: number): void {
    this.count += by;
  }
}

export function makeWidget(): Widget {
  return new Widget();
}

export const helper = (x: number) => x * 2;

interface Options {
  verbose: boolean;
}

type Id = string;
`;

describe('symbol extraction', () => {
  it('detects languages from extensions', () => {
    expect(detectLanguage('a.ts')).toBe('typescript');
    expect(detectLanguage('a.tsx')).toBe('typescript');
    expect(detectLanguage('a.py')).toBe('python');
    expect(detectLanguage('a.go')).toBe('go');
    expect(detectLanguage('a.rs')).toBe('rust');
    expect(detectLanguage('README.md')).toBeNull();
  });

  it('extracts TS classes, functions, methods, interfaces and types', () => {
    const syms = extractSymbols(TS, 'typescript');
    const names = syms.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain('class:Widget');
    expect(names).toContain('method:increment');
    expect(names).toContain('function:makeWidget');
    expect(names).toContain('function:helper');
    expect(names).toContain('interface:Options');
    expect(names).toContain('type:Id');
  });

  it('does not capture control-flow keywords as methods', () => {
    const syms = extractSymbols('if (x) {\n}\nfor (;;) {\n}\n', 'typescript');
    expect(syms).toHaveLength(0);
  });

  it('extracts Python defs and classes', () => {
    const syms = extractSymbols('class Foo:\n    def bar(self):\n        pass\n', 'python');
    expect(syms.map((s) => `${s.kind}:${s.name}`)).toEqual(['class:Foo', 'function:bar']);
  });

  it('searches symbols across a tree with fuzzy matching', () => {
    writeFileSync(join(dir, 'a.ts'), TS);
    const hits = searchSymbols(dir, 'widget');
    expect(hits.some((h) => h.name === 'Widget')).toBe(true);
    expect(hits.some((h) => h.name === 'makeWidget')).toBe(true);
    const onlyClasses = searchSymbols(dir, 'Widget', { kind: 'class' });
    expect(onlyClasses.every((h) => h.kind === 'class')).toBe(true);
  });

  it('lists document symbols', () => {
    expect(documentSymbols('a.ts', TS).length).toBeGreaterThan(3);
  });
});

describe('codebase overview', () => {
  it('summarizes languages, directories and symbol counts', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), TS);
    writeFileSync(join(dir, 'src', 'b.py'), 'def hi():\n    pass\n');
    const o = codebaseOverview(dir);
    expect(o.totalFiles).toBeGreaterThanOrEqual(2);
    expect(o.byLanguage.typescript).toBe(1);
    expect(o.byLanguage.python).toBe(1);
    expect(o.totalSymbols).toBeGreaterThan(0);
    const rendered = renderOverview(o);
    expect(rendered).toContain('Files:');
    expect(rendered).toContain('typescript');
  });

  it('produces a directory map', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    expect(searchCodebaseMap(dir)).toContain('src');
  });
});

describe('ast-grep wrapper', () => {
  it('maps file extensions to Lang keys', () => {
    expect(astLangKey('a.ts')).toBe('TypeScript');
    expect(astLangKey('a.tsx')).toBe('Tsx');
    expect(astLangKey('a.py')).toBe('Python');
    expect(astLangKey('a.unknown')).toBeNull();
  });
});

describe('AST-accurate extraction (when @ast-grep/napi is installed)', () => {
  it('extracts the same TS symbol set via the AST', async () => {
    const { astExtractSymbols } = await import('../src/tools/code/symbols.js');
    const mod = await loadAstGrep();
    if (!mod) return; // optional dep not installed; regex path is covered elsewhere
    const names = astExtractSymbols(mod, 'a.ts', TS).map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain('class:Widget');
    expect(names).toContain('method:increment');
    expect(names).toContain('function:makeWidget');
    expect(names).toContain('function:helper');
    expect(names).toContain('interface:Options');
    expect(names).toContain('type:Id');
  });

  it('classifies Go struct/interface/func/method accurately', async () => {
    const { astExtractSymbols } = await import('../src/tools/code/symbols.js');
    const mod = await loadAstGrep();
    if (!mod) return;
    const go = 'package m\ntype S struct{}\ntype I interface{}\nfunc F() {}\nfunc (s S) M() {}\n';
    const got = astExtractSymbols(mod, 'a.go', go).map((s) => `${s.kind}:${s.name}`).sort();
    expect(got).toEqual(['function:F', 'interface:I', 'method:M', 'struct:S']);
  });

  it('documentSymbols uses the AST module when provided', async () => {
    const mod = await loadAstGrep();
    if (!mod) return;
    const syms = documentSymbols('a.ts', TS, mod);
    expect(syms.some((s) => s.kind === 'method' && s.name === 'increment')).toBe(true);
  });
});

describe('code tool', () => {
  it('is registered as edit-risk (approval required)', () => {
    expect(codeTool.name).toBe('code');
    expect(codeTool.risk).toBe('edit');
  });

  it('runs search_symbols and get_document_symbols', async () => {
    writeFileSync(join(dir, 'a.ts'), TS);
    const ctx = { cwd: dir };
    const search = await codeTool.run({ operation: 'search_symbols', symbol_name: 'Widget' }, ctx);
    expect(search).toContain('Widget');
    const doc = await codeTool.run({ operation: 'get_document_symbols', file_path: 'a.ts' }, ctx);
    expect(doc).toContain('makeWidget');
  });

  it('generates a codebase overview', async () => {
    writeFileSync(join(dir, 'a.ts'), TS);
    const out = await codeTool.run({ operation: 'generate_codebase_overview' }, { cwd: dir });
    expect(out).toContain('Files:');
  });

  it('degrades gracefully for pattern_search without @ast-grep/napi', async () => {
    const mod = await loadAstGrep();
    writeFileSync(join(dir, 'a.ts'), TS);
    const out = await codeTool.run(
      { operation: 'pattern_search', pattern: 'class $NAME { $$$ }', file_path: 'a.ts' },
      { cwd: dir },
    );
    if (mod) {
      expect(typeof out).toBe('string');
    } else {
      expect(out).toContain('@ast-grep/napi');
    }
  });
});
