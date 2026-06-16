/** Local knowledge index: chunked documents persisted as JSON, searched with BM25 (no native dep). */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { walkFiles } from '../glob.js';
import { cosine, type EmbedFn } from '../../util/embeddings.js';

export interface KnowledgeChunk {
  id: string;
  text: string;
  path?: string;
  fileType: string;
  /** Optional embedding vector for semantic search. */
  embedding?: number[];
}

export interface KnowledgeContext {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  chunks: KnowledgeChunk[];
}

export interface ContextSummary {
  id: string;
  name: string;
  source: string;
  chunks: number;
  updatedAt: number;
}

export interface SearchOptions {
  contextId?: string;
  limit?: number;
  offset?: number;
  fileType?: string;
  snippetLength?: number;
  sortBy?: 'relevance' | 'path' | 'name';
}

export interface SearchHit {
  contextId: string;
  contextName: string;
  path?: string;
  fileType: string;
  score: number;
  snippet: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'with', 'this', 'that', 'from', 'have',
  'was', 'were', 'his', 'her', 'its', 'our', 'their',
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t),
  );
}

function fileTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'Markdown';
  if (ext === '.csv') return 'CSV';
  if (
    ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.c', '.h', '.cpp', '.cs', '.php', '.swift', '.kt', '.sh', '.json', '.yaml', '.yml'].includes(ext)
  ) {
    return 'Code';
  }
  return 'Text';
}

function looksBinary(content: string): boolean {
  return content.slice(0, 1024).includes('\u0000');
}

/** Split text into ~1500-char chunks on line boundaries. */
function chunkText(text: string, path: string | undefined, fileType: string, startId: number): KnowledgeChunk[] {
  const lines = text.split('\n');
  const chunks: KnowledgeChunk[] = [];
  let buf = '';
  let id = startId;
  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) chunks.push({ id: `c${id++}`, text: trimmed, path, fileType });
    buf = '';
  };
  for (const line of lines) {
    if (buf.length + line.length > 1500 && buf) flush();
    buf += line + '\n';
  }
  flush();
  return chunks;
}

export class KnowledgeStore {
  constructor(private readonly baseDir: string) {}

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
  }

  private contextFile(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  private idFor(name: string): string {
    return createHash('sha256').update(name).digest('hex').slice(0, 12);
  }

  private loadContext(id: string): KnowledgeContext | null {
    const file = this.contextFile(id);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as KnowledgeContext;
    } catch {
      return null;
    }
  }

  private save(ctx: KnowledgeContext): void {
    this.ensureDir();
    writeFileSync(this.contextFile(ctx.id), JSON.stringify(ctx), 'utf8');
  }

  /** Build chunks from a file or directory path. */
  private chunksFromPath(absPath: string, displayRoot: string): KnowledgeChunk[] {
    const out: KnowledgeChunk[] = [];
    let id = 0;
    const addFile = (file: string, rel: string) => {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        return;
      }
      if (looksBinary(content)) return;
      const fileType = fileTypeFor(file);
      const made = chunkText(content, rel, fileType, id);
      id += made.length;
      out.push(...made);
    };

    const st = statSync(absPath);
    if (st.isDirectory()) {
      for (const rel of walkFiles({ root: absPath, limit: 5000 })) {
        addFile(join(absPath, rel), rel);
      }
    } else {
      addFile(absPath, relative(displayRoot, absPath).split(sep).join('/') || absPath);
    }
    return out;
  }

  listContexts(): ContextSummary[] {
    if (!existsSync(this.baseDir)) return [];
    const out: ContextSummary[] = [];
    for (const f of readdirSync(this.baseDir)) {
      if (!f.endsWith('.json')) continue;
      const ctx = this.loadContext(f.slice(0, -5));
      if (ctx) {
        out.push({ id: ctx.id, name: ctx.name, source: ctx.source, chunks: ctx.chunks.length, updatedAt: ctx.updatedAt });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Embed chunk texts in place when an embedder is available (best-effort, never throws). */
  private async embedChunks(chunks: KnowledgeChunk[], embed?: EmbedFn): Promise<void> {
    if (!embed || chunks.length === 0) return;
    try {
      const vectors = await embed(chunks.map((c) => c.text));
      chunks.forEach((c, i) => {
        if (vectors[i]?.length) c.embedding = vectors[i];
      });
    } catch {
      /* leave chunks without embeddings → BM25 still works */
    }
  }

  /** Add raw text as a context (create or replace by name). */
  async addText(name: string, text: string, embed?: EmbedFn): Promise<ContextSummary> {
    const id = this.idFor(name);
    const now = Date.now();
    const existing = this.loadContext(id);
    const chunks = chunkText(text, undefined, 'Text', 0);
    await this.embedChunks(chunks, embed);
    const ctx: KnowledgeContext = {
      id,
      name,
      source: 'text',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      chunks,
    };
    this.save(ctx);
    return { id, name, source: ctx.source, chunks: ctx.chunks.length, updatedAt: now };
  }

  /** Index a file or directory path as a context (create or replace by name). */
  async addPath(name: string, absPath: string, displayRoot: string, embed?: EmbedFn): Promise<ContextSummary> {
    const id = this.idFor(name);
    const now = Date.now();
    const existing = this.loadContext(id);
    const chunks = this.chunksFromPath(absPath, displayRoot);
    await this.embedChunks(chunks, embed);
    const ctx: KnowledgeContext = {
      id,
      name,
      source: absPath,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      chunks,
    };
    this.save(ctx);
    return { id, name, source: ctx.source, chunks: ctx.chunks.length, updatedAt: now };
  }

  remove({ contextId, name }: { contextId?: string; name?: string }): boolean {
    const id = contextId ?? (name ? this.idFor(name) : undefined);
    if (!id) return false;
    const file = this.contextFile(id);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }

  clear(): number {
    if (!existsSync(this.baseDir)) return 0;
    const files = readdirSync(this.baseDir).filter((f) => f.endsWith('.json'));
    for (const f of files) rmSync(join(this.baseDir, f));
    return files.length;
  }

  async search(query: string, opts: SearchOptions = {}, embed?: EmbedFn): Promise<SearchHit[]> {
    const contexts = opts.contextId
      ? [this.loadContext(opts.contextId)].filter((c): c is KnowledgeContext => !!c)
      : this.listContexts().map((s) => this.loadContext(s.id)).filter((c): c is KnowledgeContext => !!c);

    // Gather the searchable corpus (optionally filtered by file type).
    interface Entry {
      ctx: KnowledgeContext;
      chunk: KnowledgeChunk;
      tokens: string[];
    }
    const corpus: Entry[] = [];
    for (const ctx of contexts) {
      for (const chunk of ctx.chunks) {
        if (opts.fileType && chunk.fileType !== opts.fileType) continue;
        corpus.push({ ctx, chunk, tokens: tokenize(chunk.text) });
      }
    }
    if (corpus.length === 0) return [];

    const qTerms = tokenize(query);
    const N = corpus.length;
    const avgdl = corpus.reduce((s, e) => s + e.tokens.length, 0) / N;
    const df = new Map<string, number>();
    for (const term of new Set(qTerms)) {
      df.set(term, corpus.filter((e) => e.tokens.includes(term)).length);
    }
    const k1 = 1.5;
    const b = 0.75;

    const scored = corpus.map((e) => {
      let score = 0;
      const dl = e.tokens.length || 1;
      for (const term of qTerms) {
        const n = df.get(term) ?? 0;
        if (n === 0) continue;
        const f = e.tokens.filter((t) => t === term).length;
        if (f === 0) continue;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl)));
      }
      return { e, score };
    });

    // Hybrid: blend normalized BM25 with semantic cosine when embeddings are present.
    let qVec: number[] | undefined;
    if (embed && corpus.some((e) => e.chunk.embedding?.length)) {
      try {
        qVec = (await embed([query]))[0];
      } catch {
        /* semantic disabled → pure BM25 */
      }
    }
    const maxBm = Math.max(1e-9, ...scored.map((s) => s.score));
    const combined = scored.map((s) => {
      if (!qVec) return { e: s.e, score: s.score };
      const bm = s.score / maxBm; // 0..1
      const sem = s.e.chunk.embedding?.length ? Math.max(0, cosine(qVec, s.e.chunk.embedding)) : 0;
      return { e: s.e, score: 0.5 * bm + 0.5 * sem };
    });

    const snippetLength = opts.snippetLength ?? 240;
    let hits: SearchHit[] = combined
      .filter((s) => s.score > 0)
      .map((s) => ({
        contextId: s.e.ctx.id,
        contextName: s.e.ctx.name,
        path: s.e.chunk.path,
        fileType: s.e.chunk.fileType,
        score: s.score,
        snippet: makeSnippet(s.e.chunk.text, qTerms, snippetLength),
      }));

    if (opts.sortBy === 'path') hits.sort((a, b2) => (a.path ?? '').localeCompare(b2.path ?? ''));
    else if (opts.sortBy === 'name') hits.sort((a, b2) => a.contextName.localeCompare(b2.contextName));
    else hits.sort((a, b2) => b2.score - a.score);

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 10;
    hits = hits.slice(offset, offset + limit);
    return hits;
  }
}

/** Extract a snippet around the first matching query term. */
function makeSnippet(text: string, qTerms: string[], length: number): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of qTerms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) pos = 0;
  const start = Math.max(0, pos - Math.floor(length / 4));
  const snippet = text.slice(start, start + length).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snippet + (start + length < text.length ? '…' : '');
}
