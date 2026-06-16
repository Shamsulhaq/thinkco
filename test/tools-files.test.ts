import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool, writeFileTool, editFileTool, listDirTool } from '../src/tools/core/files.js';
import { globToRegExp, matchGlob, walkFiles } from '../src/tools/glob.js';
import type { ToolContext } from '../src/tools/types.js';

let dir: string;
const ctx = (): ToolContext => ({ cwd: dir });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('file tools', () => {
  it('writes then reads a file', async () => {
    await writeFileTool.run({ path: 'a.txt', content: 'hello' }, ctx());
    const content = await readFileTool.run({ path: 'a.txt' }, ctx());
    expect(content).toBe('hello');
  });

  it('reads with offset and limit', async () => {
    await writeFileTool.run({ path: 'lines.txt', content: 'l1\nl2\nl3\nl4' }, ctx());
    const out = await readFileTool.run({ path: 'lines.txt', offset: 2, limit: 2 }, ctx());
    expect(out).toBe('l2\nl3');
  });

  it('edits a unique string', async () => {
    await writeFileTool.run({ path: 'e.txt', content: 'foo bar baz' }, ctx());
    const out = await editFileTool.run({ path: 'e.txt', oldString: 'bar', newString: 'QUX' }, ctx());
    expect(readFileSync(join(dir, 'e.txt'), 'utf8')).toBe('foo QUX baz');
    expect(out).toContain('- bar');
    expect(out).toContain('+ QUX');
  });

  it('write shows created preview and overwrite status', async () => {
    const created = await writeFileTool.run({ path: 'new.txt', content: 'a\nb' }, ctx());
    expect(created).toMatch(/Created new\.txt/);
    expect(created).toContain('+ a');
    const over = await writeFileTool.run({ path: 'new.txt', content: 'c' }, ctx());
    expect(over).toMatch(/Overwrote new\.txt/);
  });

  it('fails to edit a non-unique string without replaceAll', async () => {
    await writeFileTool.run({ path: 'd.txt', content: 'x x x' }, ctx());
    await expect(
      editFileTool.run({ path: 'd.txt', oldString: 'x', newString: 'y' }, ctx()),
    ).rejects.toThrow(/matches 3 places/);
  });

  it('edits with whitespace-tolerant fallback when exact match fails', async () => {
    // File uses 4-space indent; model supplies 2-space indent + different line break.
    await writeFileTool.run(
      { path: 'ws.js', content: 'function f() {\n    return 1 + 2;\n}\n' },
      ctx(),
    );
    await editFileTool.run(
      { path: 'ws.js', oldString: 'return 1 + 2;', newString: 'return 42;' },
      ctx(),
    );
    expect(readFileSync(join(dir, 'ws.js'), 'utf8')).toContain('return 42;');
  });

  it('applies a fuzzy match for a near-miss multi-line oldString', async () => {
    await writeFileTool.run(
      { path: 'fz.js', content: 'function calc(a, b) {\n  const result = a + b;\n  return result;\n}\n' },
      ctx(),
    );
    // oldString differs slightly (a+b vs a + b, "ret" wording) but is ~the same block.
    await editFileTool.run(
      {
        path: 'fz.js',
        oldString: 'function calc(a,b) {\n  const result = a+b;\n  return result;\n}',
        newString: 'function calc(a, b) {\n  return a * b;\n}',
      },
      ctx(),
    );
    const out = readFileSync(join(dir, 'fz.js'), 'utf8');
    expect(out).toContain('return a * b;');
  });

  it('gives an actionable error when oldString is truly absent', async () => {
    await writeFileTool.run({ path: 'z.txt', content: 'hello world' }, ctx());
    await expect(
      editFileTool.run({ path: 'z.txt', oldString: 'nonexistent text', newString: 'x' }, ctx()),
    ).rejects.toThrow(/Re-read the file|write the whole file|write" tool/i);
  });

  it('replaceAll edits all occurrences', async () => {
    await writeFileTool.run({ path: 'r.txt', content: 'x x x' }, ctx());
    await editFileTool.run({ path: 'r.txt', oldString: 'x', newString: 'y', replaceAll: true }, ctx());
    expect(readFileSync(join(dir, 'r.txt'), 'utf8')).toBe('y y y');
  });

  it('read throws on missing file', async () => {
    await expect(readFileTool.run({ path: 'nope.txt' }, ctx())).rejects.toThrow(/not found/);
  });

  it('caps very large default reads with a truncation note', async () => {
    const big = Array.from({ length: 2500 }, (_, i) => `line${i}`).join('\n');
    await writeFileTool.run({ path: 'big.txt', content: big }, ctx());
    const out = await readFileTool.run({ path: 'big.txt' }, ctx());
    expect(out).toMatch(/truncated: showing 2000 of 2500 lines/);
    // Explicit offset/limit bypasses the cap.
    const slice = await readFileTool.run({ path: 'big.txt', offset: 2400, limit: 5 }, ctx());
    expect(slice).toContain('line2399');
  });

  it('lists a directory', async () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'f.txt'), '');
    const out = await listDirTool.run({ path: '.' }, ctx());
    expect(out).toContain('sub/');
    expect(out).toContain('f.txt');
  });
});

describe('glob utilities', () => {
  it('matches * within a segment', () => {
    expect(matchGlob('*.ts', 'index.ts')).toBe(true);
    expect(matchGlob('*.ts', 'src/index.ts')).toBe(false);
  });

  it('matches ** across segments', () => {
    expect(matchGlob('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(matchGlob('**/*.json', 'a/b.json')).toBe(true);
  });

  it('globToRegExp escapes dots', () => {
    expect(globToRegExp('*.ts').test('x.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('xets')).toBe(false);
  });

  it('walkFiles finds matching files and skips node_modules', () => {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    writeFileSync(join(dir, 'node_modules', 'b.ts'), '');
    const files = walkFiles({ root: dir, match: '**/*.ts' });
    expect(files).toContain('src/a.ts');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });
});
