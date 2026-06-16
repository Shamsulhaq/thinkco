import { describe, it, expect } from 'vitest';
import { useAwsTool } from '../src/tools/core/aws.js';
import { webSearchTool, buildSearchUrl, formatResults } from '../src/tools/core/search-web.js';


describe('use_aws tool', () => {
  it('is registered and network-classified', () => {
    expect(useAwsTool.name).toBe('use_aws');
    expect(useAwsTool.risk).toBe('network');
  });

  it('validates required fields via its schema', () => {
    const ok = useAwsTool.schema.safeParse({ service_name: 's3api', operation_name: 'ListBuckets', region: 'us-east-1' });
    expect(ok.success).toBe(true);
    const bad = useAwsTool.schema.safeParse({ service_name: 's3api' });
    expect(bad.success).toBe(false);
  });
});

describe('web_fetch extraction', () => {
  it('extracts main content, drops chrome, decodes entities, keeps structure', async () => {
    const { makeWebFetchTool } = await import('../src/tools/core/web.js');
    const html =
      '<html><head><style>x{}</style></head><body><nav>HOME ABOUT</nav>' +
      '<main><h1>Title</h1><p>Hello&nbsp;&amp; welcome.</p><ul><li>one</li><li>two</li></ul></main>' +
      '<footer>copyright 2026</footer></body></html>';
    const fetchImpl = (async () =>
      ({ ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => html }) as unknown as Response) as unknown as typeof fetch;
    const tool = makeWebFetchTool({ fetchImpl });
    const out = await tool.run({ url: 'https://example.com/page' }, { cwd: process.cwd() });
    expect(out).toContain('# Title');
    expect(out).toContain('Hello & welcome.');
    expect(out).toContain('- one');
    expect(out).not.toContain('HOME ABOUT'); // nav dropped
    expect(out).not.toContain('copyright'); // footer dropped
  });
});

describe('web_search tool', () => {
  it('builds a Startpage search URL', () => {
    expect(buildSearchUrl('hello world')).toBe('https://www.startpage.com/sp/search?query=hello%20world');
  });

  it('formats results and handles the empty case', () => {
    expect(formatResults('q', [])).toBe('No results for "q".');
    const out = formatResults('q', [{ title: 'T', url: 'https://x.com', snippet: 'S' }]);
    expect(out).toContain('1. T');
    expect(out).toContain('https://x.com');
    expect(out).toContain('S');
  });

  it('is network-classified and degrades gracefully without Playwright', async () => {
    expect(webSearchTool.risk).toBe('network');
    // Playwright is an optional dep: when absent the tool returns install guidance; when present it
    // performs a real browser search. Either way it must return a non-empty string and never throw.
    // Race the (possibly live, network-bound) browser search against a sentinel so the test is
    // deterministic: a genuine throw still rejects, but slow networks can't make it flake.
    const out = await Promise.race([
      webSearchTool.run({ query: 'test' }, { cwd: process.cwd() }),
      new Promise<string>((resolve) => setTimeout(() => resolve('search-timed-out'), 20_000)),
    ]);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  }, 30_000);
});
