/** Dynamic model pricing from models.dev (community-maintained), fetched and cached on disk. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // refresh once a day

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** Context window in tokens, if known. */
  context?: number;
}

export interface PricingData {
  /** provider key (models.dev) → model id → price */
  byProviderModel: Record<string, Record<string, ModelPrice>>;
  /** model id → price (first provider seen) */
  byModel: Record<string, ModelPrice>;
}

// thinkco provider id → models.dev provider key (where they differ).
const PROVIDER_ALIAS: Record<string, string> = { gemini: 'google' };

interface RawModel {
  cost?: { input?: number; output?: number };
  limit?: { context?: number };
}
interface RawProvider {
  models?: Record<string, RawModel>;
}

/** Parse a models.dev api.json payload into a price lookup. */
export function parseModelsDev(json: Record<string, RawProvider>): PricingData {
  const byProviderModel: Record<string, Record<string, ModelPrice>> = {};
  const byModel: Record<string, ModelPrice> = {};
  for (const [provider, pdata] of Object.entries(json)) {
    const models = pdata?.models;
    if (!models) continue;
    for (const [modelId, m] of Object.entries(models)) {
      const c = m?.cost;
      if (!c || typeof c.input !== 'number' || typeof c.output !== 'number') continue;
      const price: ModelPrice = { inputPer1M: c.input, outputPer1M: c.output, context: m.limit?.context };
      (byProviderModel[provider] ??= {})[modelId.toLowerCase()] = price;
      if (!byModel[modelId.toLowerCase()]) byModel[modelId.toLowerCase()] = price;
    }
  }
  return { byProviderModel, byModel };
}

/** Look up a price by (provider, model): provider-specific then any-provider, exact then prefix. */
export function lookupPrice(data: PricingData, model: string, provider?: string): ModelPrice | undefined {
  const id = model.toLowerCase();
  const tables: Array<Record<string, ModelPrice> | undefined> = [];
  if (provider) {
    tables.push(data.byProviderModel[provider.toLowerCase()]);
    const alias = PROVIDER_ALIAS[provider.toLowerCase()];
    if (alias) tables.push(data.byProviderModel[alias]);
  }
  tables.push(data.byModel);
  for (const table of tables) {
    if (!table) continue;
    if (table[id]) return table[id];
    let best: ModelPrice | undefined;
    let bestLen = 0;
    for (const [key, price] of Object.entries(table)) {
      if (id.startsWith(key) && key.length > bestLen) {
        best = price;
        bestLen = key.length;
      }
    }
    if (best) return best;
  }
  return undefined;
}

function cachePath(): string {
  return join(homedir(), '.config', 'thinkco', 'pricing-cache.json');
}

/** Format a context window like 128000 → "128K", 1000000 → "1M". */
export function formatContext(ctx?: number): string {
  if (!ctx) return '';
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 ? 1 : 0)}M`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}K`;
  return String(ctx);
}

/** A compact, human-friendly annotation for a model (price + context), or '' if unknown. */
export function priceLabel(data: PricingData, model: string, provider?: string): string {
  const p = lookupPrice(data, model, provider);
  if (!p) return '';
  const ctx = p.context ? `, ${formatContext(p.context)} ctx` : '';
  return `$${p.inputPer1M}/$${p.outputPer1M} per 1M${ctx}`;
}

/**
 * Load pricing: use the on-disk cache if fresh, otherwise fetch models.dev and cache it.
 * Network/parse failures fall back to stale cache, then to an empty table. Never throws.
 */
export async function loadPricing(
  opts: { fetchImpl?: typeof fetch; cacheFile?: string; ttlMs?: number } = {},
): Promise<PricingData> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const file = opts.cacheFile ?? cachePath();
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;

  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < ttl) {
      return parseModelsDev(JSON.parse(readFileSync(file, 'utf8')) as Record<string, RawProvider>);
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    const res = await fetchImpl(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, RawProvider>;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(json));
    } catch {
      /* cache write best-effort */
    }
    return parseModelsDev(json);
  } catch {
    try {
      if (existsSync(file)) {
        return parseModelsDev(JSON.parse(readFileSync(file, 'utf8')) as Record<string, RawProvider>);
      }
    } catch {
      /* ignore */
    }
    return { byProviderModel: {}, byModel: {} };
  }
}
