/** Embeddings backend for semantic search — OpenAI-compatible or Ollama, derived from config. */
import type { Config } from '../config/index.js';

/** Embed a batch of texts into vectors. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** Cosine similarity of two equal-length vectors (0 if degenerate). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface Resolved {
  kind: 'openai' | 'ollama';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

function resolve(config: Config): Resolved | null {
  const emb = config.embedding;
  const provider = config.defaultProvider;
  const pc = config.providers[provider] ?? {};
  if (emb?.baseUrl) {
    const isOllama = /11434|\/api$/.test(emb.baseUrl);
    return {
      kind: isOllama ? 'ollama' : 'openai',
      baseUrl: emb.baseUrl,
      model: emb.model ?? (isOllama ? 'nomic-embed-text' : 'text-embedding-3-small'),
      apiKey: emb.apiKey,
    };
  }
  if (provider === 'ollama') {
    return { kind: 'ollama', baseUrl: pc.baseUrl ?? 'http://localhost:11434', model: emb?.model ?? 'nomic-embed-text' };
  }
  // OpenAI or any OpenAI-compatible provider that has a key.
  const apiKey = pc.apiKey ?? (provider === 'openai' ? process.env.OPENAI_API_KEY : undefined);
  const baseUrl = pc.baseUrl ?? (provider === 'openai' ? 'https://api.openai.com/v1' : undefined);
  if (baseUrl && apiKey) {
    return { kind: 'openai', baseUrl, model: emb?.model ?? 'text-embedding-3-small', apiKey };
  }
  return null;
}

/**
 * Build an embedder from config, or null when no embeddings backend is available (callers then
 * fall back to BM25). Never throws at construction time.
 */
export function makeEmbedder(config: Config, fetchImpl: typeof fetch = fetch): EmbedFn | null {
  const r = resolve(config);
  if (!r) return null;
  const base = r.baseUrl.replace(/\/$/, '');
  if (r.kind === 'openai') {
    return async (texts) => {
      const res = await fetchImpl(`${base}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(r.apiKey ? { authorization: `Bearer ${r.apiKey}` } : {}) },
        body: JSON.stringify({ model: r.model, input: texts }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const j = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      return (j.data ?? []).map((d) => d.embedding);
    };
  }
  // Ollama embeds one prompt per request.
  return async (texts) => {
    const out: number[][] = [];
    for (const t of texts) {
      const res = await fetchImpl(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: r.model, prompt: t }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const j = (await res.json()) as { embedding?: number[] };
      out.push(j.embedding ?? []);
    }
    return out;
  };
}
