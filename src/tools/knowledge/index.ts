/** `knowledge` tool: index and search local content with BM25, persisted under .thinkco/knowledge. */
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { KnowledgeStore, type ContextSummary } from './store.js';
import { loadConfig } from '../../config/index.js';
import { makeEmbedder, type EmbedFn } from '../../util/embeddings.js';

/** Best-effort embedder derived from project/global config (null → BM25-only). */
function embedderFor(ctx: ToolContext): EmbedFn | null {
  try {
    return makeEmbedder(loadConfig({ projectDir: ctx.cwd }));
  } catch {
    return null;
  }
}

const schema = z.object({
  command: z
    .enum(['show', 'add', 'search', 'remove', 'clear', 'update', 'status'])
    .describe('Operation: show, add, search, remove, clear, update, or status'),
  name: z.string().optional().describe('Context name (add/remove/update)'),
  value: z.string().optional().describe('Content to index: a file/dir path or raw text (add)'),
  context_id: z.string().optional().describe('Target context id (search/remove/update)'),
  query: z.string().optional().describe('Search query (search)'),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  path: z.string().optional().describe('Path to (re)index (update/remove)'),
  file_type: z.string().optional().describe('Filter results by file type (Code, Markdown, Text, CSV)'),
  snippet_length: z.number().int().positive().optional(),
  sort_by: z.enum(['relevance', 'path', 'name']).optional(),
});

type KnowledgeInput = z.infer<typeof schema>;

function storeFor(ctx: ToolContext): KnowledgeStore {
  return new KnowledgeStore(join(ctx.cwd, '.thinkco', 'knowledge'));
}

function abs(ctx: ToolContext, p: string): string {
  return isAbsolute(p) ? p : resolve(ctx.cwd, p);
}

function fmtSummary(s: ContextSummary): string {
  return `${s.id}  ${s.name}  [${s.chunks} chunk(s)]  source: ${s.source}`;
}

export const knowledgeTool: Tool<KnowledgeInput> = {
  name: 'knowledge',
  description:
    'Index and search local content (code, markdown, text, csv) with keyword (BM25) search, ' +
    'persisted across sessions under .thinkco/knowledge. Commands: show, add, search, remove, ' +
    'clear, update, status.',
  risk: 'edit', // add/remove/clear/update write index files
  schema,
  run: async (input, ctx) => {
    const store = storeFor(ctx);

    switch (input.command) {
      case 'show': {
        const contexts = store.listContexts();
        return contexts.length ? contexts.map(fmtSummary).join('\n') : '(no knowledge contexts)';
      }

      case 'status': {
        const contexts = store.listContexts();
        const totalChunks = contexts.reduce((s, c) => s + c.chunks, 0);
        return `Indexing is synchronous (no background jobs).\nContexts: ${contexts.length}, total chunks: ${totalChunks}.`;
      }

      case 'add': {
        if (!input.name) throw new Error('add requires "name"');
        if (!input.value) throw new Error('add requires "value" (a path or text)');
        const candidate = abs(ctx, input.value);
        const embed = embedderFor(ctx);
        const summary = existsSync(candidate)
          ? await store.addPath(input.name, candidate, ctx.cwd, embed ?? undefined)
          : await store.addText(input.name, input.value, embed ?? undefined);
        const mode = embed ? 'semantic + keyword' : 'keyword';
        return `Indexed "${summary.name}" (${summary.chunks} chunk(s), ${mode}). Context id: ${summary.id}.`;
      }

      case 'update': {
        if (!input.path) throw new Error('update requires "path"');
        let name = input.name;
        if (!name && input.context_id) {
          const found = store.listContexts().find((c) => c.id === input.context_id);
          if (!found) return `No context with id ${input.context_id}.`;
          name = found.name;
        }
        if (!name) throw new Error('update requires "name" or "context_id"');
        const target = abs(ctx, input.path);
        if (!existsSync(target)) return `Path not found: ${input.path}`;
        const summary = await store.addPath(name, target, ctx.cwd, embedderFor(ctx) ?? undefined);
        return `Updated "${summary.name}" (${summary.chunks} chunk(s)).`;
      }

      case 'remove': {
        if (input.path) {
          const target = abs(ctx, input.path);
          const match = store.listContexts().find((c) => c.source === target);
          if (!match) return `No context indexed from path: ${input.path}`;
          store.remove({ contextId: match.id });
          return `Removed "${match.name}".`;
        }
        const removed = store.remove({ contextId: input.context_id, name: input.name });
        return removed ? 'Removed context.' : 'No matching context to remove.';
      }

      case 'clear': {
        const n = store.clear();
        return `Cleared ${n} context(s).`;
      }

      case 'search': {
        if (!input.query) throw new Error('search requires "query"');
        const hits = await store.search(
          input.query,
          {
            contextId: input.context_id,
            limit: input.limit,
            offset: input.offset,
            fileType: input.file_type,
            snippetLength: input.snippet_length,
            sortBy: input.sort_by,
          },
          embedderFor(ctx) ?? undefined,
        );
        if (hits.length === 0) return `No results for "${input.query}".`;
        return hits
          .map(
            (h, i) =>
              `${i + 1}. [${h.fileType}] ${h.contextName}${h.path ? ` · ${h.path}` : ''} (score ${h.score.toFixed(2)})\n   ${h.snippet}`,
          )
          .join('\n\n');
      }
    }
  },
};
