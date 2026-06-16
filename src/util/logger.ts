/** Minimal leveled logger (no deps). Level controlled via config or THINKCO_LOG_LEVEL. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export class Logger {
  private level: number;
  private sink: ((level: LogLevel, line: string) => void) | undefined;

  constructor(level: LogLevel = 'info') {
    const envLevel = process.env.THINKCO_LOG_LEVEL as LogLevel | undefined;
    this.level = LEVELS[envLevel ?? level] ?? LEVELS.info;
  }

  setLevel(level: LogLevel): void {
    this.level = LEVELS[level] ?? LEVELS.info;
  }

  /**
   * Redirect log output to a custom sink (or back to stderr with `undefined`). Used by the Ink
   * TUI to capture log lines into the scrollback — writing raw to stderr while a full-screen Ink
   * app is rendering corrupts its frame accounting (the input box appears to jump to the top).
   */
  setSink(sink: ((level: LogLevel, line: string) => void) | undefined): void {
    this.sink = sink;
  }

  private log(level: LogLevel, prefix: string, args: unknown[]): void {
    if (LEVELS[level] < this.level) return;
    const line = `${prefix} ${args.map(fmt).join(' ')}`;
    if (this.sink) {
      this.sink(level, line);
      return;
    }
    process.stderr.write(`${line}\n`);
  }

  debug(...args: unknown[]): void {
    this.log('debug', '[debug]', args);
  }
  info(...args: unknown[]): void {
    this.log('info', '[info]', args);
  }
  warn(...args: unknown[]): void {
    this.log('warn', '[warn]', args);
  }
  error(...args: unknown[]): void {
    this.log('error', '[error]', args);
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack ?? v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const logger = new Logger();
