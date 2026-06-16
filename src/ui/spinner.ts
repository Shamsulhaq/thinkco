/** A lightweight thinking spinner that overwrites a single line. */
import { c, CLEAR_LINE } from './ansi.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private startedAt = 0;

  constructor(
    private readonly label = 'Thinking',
    private readonly write: (s: string) => void = (s) => process.stdout.write(s),
  ) {}

  start(): void {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(0);
      const f = FRAMES[this.frame % FRAMES.length]!;
      this.frame++;
      this.write(`${CLEAR_LINE}${c.magenta(f)} ${c.dim(`${this.label}… (${elapsed}s · esc to interrupt)`)}`);
    }, 90);
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.write(CLEAR_LINE);
  }
}
