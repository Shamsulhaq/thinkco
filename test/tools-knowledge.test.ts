import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeStore, tokenize } from '../src/tools/knowledge/store.js';
import { knowledgeTool } from '../src/tools/knowledge/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-kb-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('knowledge store', () => {
  it('tokenizes, dropping stopwords and short tokens', () => {
    expect(tokenize('The quick brown fox')).toEqual(['quick', 'brown', 'fox']);
  });

  it('indexes text and finds it via BM25 search', async () => {
    const store = new KnowledgeStore(join(dir, 'kb'));
    await store.addText('notes', 'The permission engine classifies risky shell commands and prompts the user.');
    await store.addText('other', 'Completely unrelated content about gardening and flowers.');
    const hits = await store.search('permission shell');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.contextName).toBe('notes');
    expect(hits[0]!.snippet.toLowerCase()).toContain('permission');
  });

  it('indexes a directory of files and filters by file type', async () => {
    const store = new KnowledgeStore(join(dir, 'kb'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'a.md'), '# Title\nThe agent loop streams provider events.');
    writeFileSync(join(dir, 'docs', 'b.ts'), 'export const provider = "anthropic";');
    const summary = await store.addPath('docs', join(dir, 'docs'), dir);
    expect(summary.chunks).toBeGreaterThanOrEqual(2);
    const md = await store.search('provider', { fileType: 'Markdown' });
    expect(md.every((h) => h.fileType === 'Markdown')).toBe(true);
  });

  it('lists, removes and clears contexts', async () => {
    const store = new KnowledgeStore(join(dir, 'kb'));
    await store.addText('a', 'alpha content');
    await store.addText('b', 'beta content');
    expect(store.listContexts().length).toBe(2);
    expect(store.remove({ name: 'a' })).toBe(true);
    expect(store.listContexts().length).toBe(1);
    expect(store.clear()).toBe(1);
    expect(store.listContexts().length).toBe(0);
  });
});

describe('hybrid semantic search', () => {
  it('blends BM25 with embedding cosine when an embedder is provided', async () => {
    const store = new KnowledgeStore(join(dir, 'kb'));
    // Deterministic fake embedder: feline-ish → [1,0], car-ish → [0,1], else neutral.
    const embed = (async (texts: string[]) =>
      texts.map((t) =>
        /cat|feline|kitten/i.test(t) ? [1, 0] : /car|vehicle|automobile/i.test(t) ? [0, 1] : [0.5, 0.5],
      )) as unknown as (texts: string[]) => Promise<number[][]>;
    await store.addText('a', 'A feline is a kitten that purrs.', embed);
    await store.addText('b', 'A vehicle with four wheels drives fast.', embed);
    // "automobile" shares no keyword with "vehicle" but is semantically closer to doc b.
    const hits = await store.search('automobile', {}, embed);
    expect(hits[0]!.contextName).toBe('b');
  });
});

describe('knowledge tool', () => {
  const ctx = () => ({ cwd: dir });

  it('is edit-risk', () => {
    expect(knowledgeTool.name).toBe('knowledge');
    expect(knowledgeTool.risk).toBe('edit');
  });

  it('adds text, shows, searches and clears', async () => {
    const add = await knowledgeTool.run({ command: 'add', name: 'kb', value: 'thinkco supports multiple providers like anthropic and openai' }, ctx());
    expect(add).toContain('Indexed "kb"');

    const show = await knowledgeTool.run({ command: 'show' }, ctx());
    expect(show).toContain('kb');

    const search = await knowledgeTool.run({ command: 'search', query: 'providers anthropic' }, ctx());
    expect(search).toContain('kb');
    expect(search.toLowerCase()).toContain('anthropic');

    const status = await knowledgeTool.run({ command: 'status' }, ctx());
    expect(status).toContain('Contexts: 1');

    const cleared = await knowledgeTool.run({ command: 'clear' }, ctx());
    expect(cleared).toContain('Cleared 1');
  });

  it('indexes a path when value is an existing file', async () => {
    writeFileSync(join(dir, 'doc.md'), '# Heading\nThe scheduler runs tasks on an interval.');
    const add = await knowledgeTool.run({ command: 'add', name: 'docs', value: 'doc.md' }, ctx());
    expect(add).toContain('Indexed "docs"');
    const search = await knowledgeTool.run({ command: 'search', query: 'scheduler interval' }, ctx());
    expect(search).toContain('doc.md');
  });

  it('returns a friendly message when searching with no contexts', async () => {
    const out = await knowledgeTool.run({ command: 'search', query: 'anything' }, ctx());
    expect(out).toContain('No results');
  });
});
