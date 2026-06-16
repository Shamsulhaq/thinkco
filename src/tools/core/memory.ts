/** memory tool: lets the agent read/maintain cross-session memory and search it. */
import { z } from 'zod';
import type { Tool, ToolContext } from '../types.js';
import { MemoryStore } from '../../context/store.js';
import { TaskStore } from '../../agent/tasks.js';

const schema = z.object({
  command: z
    .enum(['read', 'remember', 'note', 'search', 'checkpoint'])
    .describe('read (all memory), remember (append durable fact to MEMORY.md), note (scratch), search, checkpoint (latest snapshot)'),
  text: z.string().optional().describe('Fact/note text (remember/note)'),
  query: z.string().optional().describe('Search query (search)'),
});

type MemoryInput = z.infer<typeof schema>;

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length >= 2);
}

/** Rank lines/paragraphs by query term overlap (lightweight keyword relevance). */
function search(corpus: Array<{ source: string; text: string }>, query: string, limit = 8): string {
  const q = new Set(tokenize(query));
  if (q.size === 0) return '(empty query)';
  const scored = corpus
    .map((c) => {
      const toks = tokenize(c.text);
      const score = toks.reduce((n, t) => n + (q.has(t) ? 1 : 0), 0);
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (scored.length === 0) return `No memory matches for "${query}".`;
  return scored.map((c) => `[${c.source}] ${c.text.trim().slice(0, 240)}`).join('\n');
}

export const memoryTool: Tool<MemoryInput> = {
  name: 'memory',
  description:
    'Maintain and query persistent cross-session memory (.thinkco/memory). Commands: read, ' +
    'remember <text> (durable fact → MEMORY.md), note <text> (scratch → notes.md), search <query>, ' +
    'checkpoint (read the latest state snapshot).',
  risk: 'read',
  schema,
  run: async (input, ctx: ToolContext) => {
    const store = new MemoryStore(ctx.cwd);
    switch (input.command) {
      case 'read': {
        const s = store.snapshot();
        return (
          [
            s.memory && `## MEMORY.md\n${s.memory}`,
            s.notes && `## notes.md\n${s.notes}`,
            s.checkpoint && `## checkpoint.md\n${s.checkpoint}`,
          ]
            .filter(Boolean)
            .join('\n\n') || '(memory is empty)'
        );
      }
      case 'remember': {
        if (!input.text) throw new Error('memory remember requires "text"');
        const existing = store.memory();
        store.setMemory(existing ? `${existing}\n- ${input.text.trim()}` : `# Project memory\n- ${input.text.trim()}`);
        return 'Saved to MEMORY.md.';
      }
      case 'note': {
        if (!input.text) throw new Error('memory note requires "text"');
        store.appendNote(input.text);
        return 'Appended to notes.md.';
      }
      case 'checkpoint':
        return store.checkpoint() || '(no checkpoint yet)';
      case 'search': {
        if (!input.query) throw new Error('memory search requires "query"');
        const s = store.snapshot();
        const corpus: Array<{ source: string; text: string }> = [];
        for (const para of s.memory.split(/\n{2,}|\n- /)) if (para.trim()) corpus.push({ source: 'MEMORY.md', text: para });
        for (const para of s.notes.split(/\n+/)) if (para.trim()) corpus.push({ source: 'notes.md', text: para });
        for (const para of s.checkpoint.split(/\n{2,}/)) if (para.trim()) corpus.push({ source: 'checkpoint.md', text: para });
        for (const t of new TaskStore(ctx.cwd).list()) {
          const prog = new TaskStore(ctx.cwd).progress(t.id);
          if (prog) corpus.push({ source: `task ${t.id}`, text: prog });
        }
        return search(corpus, input.query);
      }
    }
  },
};
