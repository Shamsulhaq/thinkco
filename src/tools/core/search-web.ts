/** web_search: scrape search results via a headless Playwright browser (Startpage). */
import { z } from 'zod';
import type { Tool } from '../types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const schema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().int().positive().max(20).optional().describe('Max results (default 5)'),
});

type SearchInput = z.infer<typeof schema>;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Build the Startpage search URL for a query. */
export function buildSearchUrl(query: string): string {
  return `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`;
}

/** Format results into a compact, model-friendly list. */
export function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No results for "${query}".`;
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
    .join('\n\n');
}

// Minimal structural types for the optional Playwright dependency (avoids a hard type dep).
interface PwElement {
  querySelector(sel: string): PwElement | null;
  querySelectorAll(sel: string): PwElement[];
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly parentElement: PwElement | null;
  cloneNode(deep: boolean): PwElement;
  remove(): void;
}
interface PwPage {
  goto(url: string, opts?: unknown): Promise<unknown>;
  waitForSelector(selector: string, opts?: unknown): Promise<unknown>;
  $$eval<T>(selector: string, fn: (els: PwElement[]) => T): Promise<T>;
}
interface PwBrowser {
  newPage(opts?: unknown): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwChromium {
  launch(opts?: unknown): Promise<PwBrowser>;
}

/** Lazily load Playwright's chromium; returns null if the package isn't installed. */
async function loadChromium(): Promise<PwChromium | null> {
  try {
    const spec = 'playwright';
    const mod = (await import(spec)) as { chromium?: PwChromium };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

const INSTALL_HINT =
  'web_search requires Playwright. Install it with `npm i playwright` and download a browser with `npx playwright install chromium`.';

export const webSearchTool: Tool<SearchInput> = {
  name: 'web_search',
  description:
    'Search the web and return the top results (title, URL, snippet). Uses a headless browser, so it ' +
    'works for queries that need a real browser. Requires Playwright + a chromium install.',
  risk: 'network',
  schema,
  run: async (input, ctx) => {
    const chromium = await loadChromium();
    if (!chromium) return INSTALL_HINT;

    let browser: PwBrowser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ userAgent: UA, locale: 'en-US' });
      await page.goto(buildSearchUrl(input.query), { waitUntil: 'domcontentloaded', timeout: 25_000 });
      try {
        await page.waitForSelector('a.result-title', { timeout: 12_000 });
      } catch {
        return `No results for "${input.query}".`;
      }

      const raw = await page.$$eval('a.result-title', (anchors) =>
        anchors.map((a) => {
          // Title text can include an injected <style> block; strip style/script nodes first.
          const clone = a.cloneNode(true);
          clone.querySelectorAll('style, script').forEach((e) => e.remove());
          const title = (clone.textContent ?? '').trim();
          // Snippet lives in a nearby description block; walk up a few ancestors to find it.
          let box: PwElement | null = a.parentElement;
          let snippet = '';
          for (let i = 0; i < 6 && box; i++) {
            const d = box.querySelector('.w-gl__description') ?? box.querySelector('p');
            const text = d?.textContent?.trim() ?? '';
            if (text.length > 20) {
              snippet = text;
              break;
            }
            box = box.parentElement;
          }
          return { href: a.getAttribute('href') ?? '', title, snippet };
        }),
      );

      const limit = input.limit ?? 5;
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      for (const r of raw) {
        if (!r.href.startsWith('http') || !r.title || seen.has(r.href)) continue;
        seen.add(r.href);
        results.push({ title: r.title, url: r.href, snippet: r.snippet.slice(0, 300) });
        if (results.length >= limit) break;
      }

      return formatResults(input.query, results);
    } catch (err) {
      if (ctx.signal?.aborted) return 'web_search cancelled.';
      const msg = err instanceof Error ? err.message : String(err);
      return `web_search failed: ${msg}. If browsers are not installed, run \`npx playwright install chromium\`.`;
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};
