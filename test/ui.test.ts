import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderInline, MarkdownStream } from '../src/ui/markdown.js';
import { box, visibleLength } from '../src/ui/ansi.js';
import { CliSink } from '../src/frontends/cli.js';

// Disable colors so assertions can match plain text.
beforeEach(() => {
  process.env.NO_COLOR = '1';
});
afterEach(() => {
  delete process.env.NO_COLOR;
});

describe('markdown rendering', () => {
  it('strips inline markers when colors are off', () => {
    expect(renderInline('a **bold** and `code`')).toBe('a bold and code');
  });

  it('renders headers and bullets per completed line', () => {
    const out: string[] = [];
    const md = new MarkdownStream((s) => out.push(s));
    md.push('# Title\n- item one\n');
    const text = out.join('');
    expect(text).toContain('Title');
    expect(text).not.toContain('# Title');
    expect(text).toContain('• item one');
  });

  it('passes code fences through', () => {
    const out: string[] = [];
    const md = new MarkdownStream((s) => out.push(s));
    md.push('```ts\nconst x = 1;\n```\n');
    expect(out.join('')).toContain('const x = 1;');
  });

  it('flushes a trailing partial line', () => {
    const out: string[] = [];
    const md = new MarkdownStream((s) => out.push(s));
    md.push('no newline here');
    expect(out.join('')).toBe('');
    md.flush();
    expect(out.join('')).toContain('no newline here');
  });
});

describe('box', () => {
  it('pads all rows to the same visible width', () => {
    const rendered = box(['short', 'a much longer line']);
    const rows = rendered.split('\n');
    const widths = rows.map((r) => visibleLength(r));
    expect(new Set(widths).size).toBe(1);
  });
});

describe('CliSink Claude-style formatting', () => {
  it('renders tool calls with ⏺ and a summarized arg', () => {
    const out: string[] = [];
    const sink = new CliSink((s) => out.push(s));
    sink.toolCall({ id: '1', name: 'shell', input: { command: 'ls -la' } });
    expect(out.join('')).toContain('⏺ shell(ls -la)');
  });

  it('renders tool results with ⎿ and truncates long output', () => {
    const out: string[] = [];
    const sink = new CliSink((s) => out.push(s));
    const many = Array.from({ length: 25 }, (_, i) => `line${i}`).join('\n');
    sink.toolResult({ id: '1', name: 'shell', input: {} }, { output: many, isError: false });
    const text = out.join('');
    expect(text).toContain('⎿');
    expect(text).toContain('line0');
    expect(text).toMatch(/\+7 more lines/);
  });

  it('streams assistant markdown text', () => {
    const out: string[] = [];
    const sink = new CliSink((s) => out.push(s));
    sink.text('# Heading\n');
    sink.finalize();
    expect(out.join('')).toContain('Heading');
  });
});
