/** Streaming markdown → ANSI renderer. Renders completed lines as they arrive. */
import { c } from './ansi.js';

/** Apply inline markdown styling (code, bold, italic, links). */
export function renderInline(s: string): string {
  let out = s;
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => c.yellow(code));
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => c.bold(t));
  out = out.replace(/__([^_]+)__/g, (_m, t: string) => c.bold(t));
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_m, pre: string, t: string) => `${pre}${c.italic(t)}`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => `${c.cyan(text)}${c.gray(` (${url})`)}`);
  return out;
}

export class MarkdownStream {
  private buf = '';
  private inFence = false;

  constructor(private readonly write: (s: string) => void) {}

  push(text: string): void {
    this.buf += text;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.write(this.renderLine(line) + '\n');
    }
  }

  /** Emit any buffered partial line. */
  flush(): void {
    if (this.buf.length) {
      this.write(this.renderLine(this.buf));
      this.buf = '';
    }
  }

  private renderLine(line: string): string {
    if (/^\s*```/.test(line)) {
      this.inFence = !this.inFence;
      return c.gray(line);
    }
    if (this.inFence) {
      return c.green(line);
    }
    const header = line.match(/^(#{1,6})\s+(.*)$/);
    if (header) return c.bold(c.cyan(header[2]!));
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) return `${bullet[1]}${c.cyan('•')} ${renderInline(bullet[2]!)}`;
    const numbered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numbered) return `${numbered[1]}${c.cyan(numbered[2] + '.')} ${renderInline(numbered[3]!)}`;
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) return c.gray(`┃ ${quote[1]}`);
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return c.gray('─'.repeat(40));
    return renderInline(line);
  }
}
