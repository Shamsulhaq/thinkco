import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModelsDev, lookupPrice, loadPricing } from '../src/util/pricing.js';
import { priceLabel, formatContext } from '../src/util/pricing.js';

const SAMPLE = {
  openai: {
    models: {
      'gpt-4o': { cost: { input: 2.5, output: 10 }, limit: { context: 128000 } },
      'gpt-4o-mini': { cost: { input: 0.15, output: 0.6 } },
      'text-embedding-3-large': {}, // no cost → skipped
    },
  },
  anthropic: {
    models: { 'claude-sonnet-4-20250514': { cost: { input: 3, output: 15 } } },
  },
  opencode: {
    models: { 'deepseek-v4-flash': { cost: { input: 0.1, output: 0.2 } } },
  },
};

describe('pricing: parse + lookup', () => {
  const data = parseModelsDev(SAMPLE);

  it('parses per-provider and flat model price tables', () => {
    expect(data.byProviderModel.openai['gpt-4o']).toEqual({ inputPer1M: 2.5, outputPer1M: 10, context: 128000 });
    expect(data.byModel['deepseek-v4-flash']).toMatchObject({ inputPer1M: 0.1, outputPer1M: 0.2 });
    // models without cost are skipped
    expect(data.byModel['text-embedding-3-large']).toBeUndefined();
  });

  it('matches exact ids, provider-specific, and dated-variant prefixes', () => {
    expect(lookupPrice(data, 'gpt-4o', 'openai')).toMatchObject({ inputPer1M: 2.5, outputPer1M: 10 });
    // dated variant → longest prefix match (gpt-4o-mini wins over gpt-4o)
    expect(lookupPrice(data, 'gpt-4o-mini-2024-07-18', 'openai')).toMatchObject({ inputPer1M: 0.15, outputPer1M: 0.6 });
    expect(lookupPrice(data, 'claude-sonnet-4-20250514', 'anthropic')?.inputPer1M).toBe(3);
    expect(lookupPrice(data, 'deepseek-v4-flash', 'opencode')?.outputPer1M).toBe(0.2);
    expect(lookupPrice(data, 'no-such-model')).toBeUndefined();
  });

  it('formats context windows and price labels', () => {
    expect(formatContext(128000)).toBe('128K');
    expect(formatContext(1_000_000)).toBe('1M');
    expect(formatContext(undefined)).toBe('');
    expect(priceLabel(data, 'gpt-4o', 'openai')).toBe('$2.5/$10 per 1M, 128K ctx');
    // no context available → price only
    expect(priceLabel(data, 'gpt-4o-mini', 'openai')).toBe('$0.15/$0.6 per 1M');
    // unknown model → empty annotation
    expect(priceLabel(data, 'no-such-model')).toBe('');
  });
});

describe('pricing: cached load', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thinkco-price-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fetches and caches when no fresh cache exists', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: true, status: 200, json: async () => SAMPLE } as unknown as Response;
    }) as unknown as typeof fetch;
    const cacheFile = join(dir, 'cache.json');
    const data = await loadPricing({ fetchImpl, cacheFile, ttlMs: 60_000 });
    expect(lookupPrice(data, 'gpt-4o', 'openai')?.inputPer1M).toBe(2.5);
    expect(calls).toBe(1);
    // second call uses the fresh cache (no extra fetch)
    await loadPricing({ fetchImpl, cacheFile, ttlMs: 60_000 });
    expect(calls).toBe(1);
  });

  it('falls back to stale cache when the network fails', async () => {
    const cacheFile = join(dir, 'cache.json');
    writeFileSync(cacheFile, JSON.stringify(SAMPLE));
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    // ttl 0 forces a fetch attempt, which fails → stale cache used
    const data = await loadPricing({ fetchImpl: failing, cacheFile, ttlMs: 0 });
    expect(lookupPrice(data, 'gpt-4o', 'openai')?.inputPer1M).toBe(2.5);
  });

  it('returns an empty table when offline with no cache', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const data = await loadPricing({ fetchImpl: failing, cacheFile: join(dir, 'none.json'), ttlMs: 0 });
    expect(Object.keys(data.byModel)).toHaveLength(0);
  });
});
