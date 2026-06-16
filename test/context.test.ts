import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandMentions } from '../src/context/mentions.js';
import { loadMemory, composeSystemPrompt } from '../src/context/memory.js';
import { buildIndex, retrieveRelevant } from '../src/context/index.js';
import {
  estimateTokens,
  estimateMessagesTokens,
  compactConversation,
} from '../src/context/budget.js';
import type { Message } from '../src/types/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-ctx-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('expandMentions', () => {
  it('inlines @file contents', () => {
    writeFileSync(join(dir, 'note.txt'), 'secret-content-xyz');
    const res = expandMentions('look at @note.txt please', dir);
    expect(res.files).toEqual(['note.txt']);
    expect(res.text).toContain('secret-content-xyz');
  });

  it('ignores non-existent mentions', () => {
    const res = expandMentions('check @nope.txt', dir);
    expect(res.files).toEqual([]);
    expect(res.text).toBe('check @nope.txt');
  });
});

describe('loadMemory', () => {
  it('loads AGENT.md into memory', () => {
    writeFileSync(join(dir, 'AGENT.md'), 'Project rules here.');
    const mem = loadMemory(dir);
    expect(mem.sources).toContain('AGENT.md');
    expect(mem.content).toContain('Project rules here.');
  });

  it('composeSystemPrompt appends memory', () => {
    const mem = { sources: ['AGENT.md'], content: 'MEM' };
    expect(composeSystemPrompt('BASE', mem)).toContain('BASE');
    expect(composeSystemPrompt('BASE', mem)).toContain('MEM');
  });

  it('returns base unchanged with no memory', () => {
    expect(composeSystemPrompt('BASE', { sources: [], content: '' })).toBe('BASE');
  });
});

describe('file index + retrieval', () => {
  it('retrieves relevant files by keyword overlap', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'auth.ts'), 'function login(user) { return authenticate(user); }');
    writeFileSync(join(dir, 'src', 'math.ts'), 'export const add = (a, b) => a + b;');
    const index = buildIndex({ root: dir });
    const results = retrieveRelevant('authenticate login user', index);
    expect(results[0]?.path).toBe('src/auth.ts');
  });
});

describe('budgeting + compaction', () => {
  it('estimates tokens', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });

  it('does not compact under budget', async () => {
    const msgs: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const res = await compactConversation(msgs, { maxTokens: 1000 });
    expect(res.compacted).toBe(false);
  });

  it('compacts over budget, keeping recent messages', async () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: 'x'.repeat(400) }] });
    }
    const before = estimateMessagesTokens(msgs);
    const res = await compactConversation(msgs, { maxTokens: 100, keepRecent: 4 });
    expect(res.compacted).toBe(true);
    expect(res.messages.length).toBe(5); // summary + 4 recent
    expect(estimateMessagesTokens(res.messages)).toBeLessThan(before);
  });

  it('uses a custom summarizer when provided', async () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: 'y'.repeat(400) }] });
    }
    const res = await compactConversation(msgs, {
      maxTokens: 50,
      keepRecent: 2,
      summarize: async () => 'CUSTOM SUMMARY',
    });
    expect(res.messages[0]?.content[0]).toMatchObject({ type: 'text' });
    expect((res.messages[0]?.content[0] as { text: string }).text).toContain('CUSTOM SUMMARY');
  });
});
