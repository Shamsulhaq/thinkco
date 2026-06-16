import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globTool, grepTool } from '../src/tools/core/search.js';
import { shellTool } from '../src/tools/core/shell.js';
import { gitTool } from '../src/tools/core/git.js';
import { makeWebFetchTool } from '../src/tools/core/web.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/core/index.js';
import type { ToolContext } from '../src/tools/types.js';

let dir: string;
const ctx = (): ToolContext => ({ cwd: dir });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-search-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('search tools', () => {
  it('glob finds files by pattern', async () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    writeFileSync(join(dir, 'b.md'), '');
    const out = await globTool.run({ pattern: '**/*.ts' }, ctx());
    expect(out).toContain('src/a.ts');
    expect(out).not.toContain('b.md');
  });

  it('grep finds matching lines', async () => {
    writeFileSync(join(dir, 'code.ts'), 'const x = 1;\nfunction foo() {}\n');
    const out = await grepTool.run({ pattern: 'function\\s+\\w+' }, ctx());
    expect(out).toMatch(/code\.ts:2:/);
  });

  it('grep returns no matches message', async () => {
    writeFileSync(join(dir, 'x.txt'), 'nothing here');
    const out = await grepTool.run({ pattern: 'zzzz' }, ctx());
    expect(out).toBe('(no matches)');
  });

  it('grep rejects invalid regex', async () => {
    await expect(grepTool.run({ pattern: '(' }, ctx())).rejects.toThrow(/Invalid regex/);
  });
});

describe('shell tool', () => {
  it('runs a command and captures output + exit code', async () => {
    const out = await shellTool.run({ command: 'echo hello-shell' }, ctx());
    expect(out).toContain('hello-shell');
    expect(out).toContain('[exit code: 0]');
  });

  it('reports non-zero exit code', async () => {
    const out = await shellTool.run({ command: 'exit 3' }, ctx());
    expect(out).toContain('[exit code: 3]');
  });
});

describe('git tool', () => {
  it('rejects disallowed subcommands', async () => {
    await expect(gitTool.run({ subcommand: 'push' }, ctx())).rejects.toThrow(/not allowed/);
  });
});

describe('web_fetch tool', () => {
  it('fetches and strips HTML', async () => {
    const fakeFetch = (async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => '<html><body><p>Hello <b>World</b></p><script>bad()</script></body></html>',
      }) as unknown as Response) as unknown as typeof fetch;
    const tool = makeWebFetchTool({ fetchImpl: fakeFetch });
    const out = await tool.run({ url: 'https://example.com' }, ctx());
    expect(out).toContain('Hello World');
    expect(out).not.toContain('bad()');
  });

  it('throws on non-ok response', async () => {
    const fakeFetch = (async () =>
      ({ ok: false, status: 404, headers: { get: () => '' }, text: async () => '' }) as unknown as Response) as unknown as typeof fetch;
    const tool = makeWebFetchTool({ fetchImpl: fakeFetch });
    await expect(tool.run({ url: 'https://example.com/missing' }, ctx())).rejects.toThrow(/404/);
  });

  it('blocks private/loopback hosts (SSRF guard)', async () => {
    const fakeFetch = (async () =>
      ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'secret' }) as unknown as Response) as unknown as typeof fetch;
    const tool = makeWebFetchTool({ fetchImpl: fakeFetch });
    await expect(tool.run({ url: 'http://localhost:8080/' }, ctx())).rejects.toThrow(/SSRF|private/i);
    await expect(tool.run({ url: 'http://169.254.169.254/latest/meta-data' }, ctx())).rejects.toThrow(/SSRF|private/i);
    await expect(tool.run({ url: 'http://192.168.1.1/' }, ctx())).rejects.toThrow(/SSRF|private/i);
  });

  it('allows private hosts when explicitly enabled', async () => {
    const fakeFetch = (async () =>
      ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'ok' }) as unknown as Response) as unknown as typeof fetch;
    const tool = makeWebFetchTool({ fetchImpl: fakeFetch, allowPrivateHosts: true });
    expect(await tool.run({ url: 'http://localhost:8080/' }, ctx())).toBe('ok');
  });
});

describe('registerCoreTools', () => {
  it('registers all core tools with JSON Schema defs', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg);
    const names = reg.list().map((t) => t.name).sort();
    expect(names).toEqual(['code', 'edit', 'git', 'glob', 'grep', 'knowledge', 'list', 'memory', 'read', 'shell', 'task', 'use_aws', 'web_fetch', 'web_search', 'write']);
    const defs = reg.toToolDefs();
    expect(defs.every((d) => typeof d.inputSchema === 'object')).toBe(true);
  });

  it('emits standard JSON Schema (numeric exclusiveMinimum, no $schema) for strict providers', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg);
    const read = reg.toToolDefs().find((d) => d.name === 'read')!;
    const schema = read.inputSchema as { $schema?: unknown; properties: { offset: { exclusiveMinimum?: unknown } } };
    expect(schema.$schema).toBeUndefined();
    // OpenAPI3 would emit `true` here, which DeepSeek/OpenAI-compatible APIs reject.
    expect(schema.properties.offset.exclusiveMinimum).toBe(0);
  });
});
