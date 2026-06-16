/** web_fetch tool: fetch a URL and return text (HTML lightly stripped). */
import { z } from 'zod';
import type { Tool } from '../types.js';

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&copy;': '©', '&reg;': '®',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

/**
 * Extract readable main content from HTML: isolate <main>/<article> when present, drop
 * nav/header/footer/aside/script/style/forms, keep links/headings/list markers, and decode entities.
 */
function stripHtml(html: string): string {
  let h = html;
  // Prefer the primary content region if the page marks one.
  const main = h.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (main) h = main[1]!;
  // Remove non-content regions and noise entirely.
  h = h
    .replace(/<(script|style|noscript|template|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Preserve some structure as plain text.
  h = h
    .replace(/<\s*(h[1-6])\b[^>]*>/gi, '\n\n# ')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\s*\/(p|div|section|tr|h[1-6]|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n');
  // Drop remaining tags, decode entities, normalize whitespace.
  return decodeEntities(h.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface WebFetchDeps {
  fetchImpl?: typeof fetch;
  /** Allow fetching private/loopback hosts (default false — SSRF guard on). */
  allowPrivateHosts?: boolean;
}

/** True if a hostname/IP is loopback, private, or link-local (SSRF risk). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 ranges: 127/8, 10/8, 192.168/16, 172.16-31/12, 169.254/16 (link-local incl. cloud metadata).
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  // IPv6 unique-local / link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return false;
}

export function makeWebFetchTool(deps: WebFetchDeps = {}): Tool<{ url: string; maxChars?: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: 'web_fetch',
    description: 'Fetch a URL over HTTP(S) and return its text content (HTML is stripped to text).',
    risk: 'network',
    schema: z.object({
      url: z.string().url(),
      maxChars: z.number().int().positive().optional(),
    }),
    run: async (input, ctx) => {
      let parsed: URL;
      try {
        parsed = new URL(input.url);
      } catch {
        throw new Error(`Invalid URL: ${input.url}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported protocol: ${parsed.protocol} (only http/https)`);
      }
      if (!deps.allowPrivateHosts && isPrivateHost(parsed.hostname)) {
        throw new Error(
          `Refusing to fetch private/loopback host "${parsed.hostname}" (SSRF guard). ` +
            `Enable allowPrivateHosts in config to override.`,
        );
      }
      const res = await fetchImpl(input.url, { signal: ctx.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${input.url}`);
      const contentType = res.headers.get('content-type') ?? '';
      const body = await res.text();
      const text = contentType.includes('html') ? stripHtml(body) : body;
      const max = input.maxChars ?? 20_000;
      return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
    },
  };
}

export const webFetchTool = makeWebFetchTool();
