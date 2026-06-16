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

  constructor(level: LogLevel = 'info') {
    const envLevel = process.env.THINKCO_LOG_LEVEL as LogLevel | undefined;
    this.level = LEVELS[envLevel ?? level] ?? LEVELS.info;
  }

  setLevel(level: LogLevel): void {
    this.level = LEVELS[level] ?? LEVELS.info;
  }

  private log(level: LogLevel, prefix: string, args: unknown[]): void {
    if (LEVELS[level] < this.level) return;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stderr;
    stream.write(`${prefix} ${args.map(fmt).join(' ')}\n`);
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
