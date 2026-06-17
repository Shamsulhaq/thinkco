/** Centralized error types for thinkco. */

export class ThinkcoError extends Error {
  readonly code: string;
  constructor(message: string, code = 'THINKCO_ERROR') {
    super(message);
    this.name = 'ThinkcoError';
    this.code = code;
  }
}

export class ConfigError extends ThinkcoError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ProviderError extends ThinkcoError {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
    this.retryable = retryable;
  }
}

export class ToolError extends ThinkcoError {
  constructor(message: string) {
    super(message, 'TOOL_ERROR');
    this.name = 'ToolError';
  }
}

export class PermissionDeniedError extends ThinkcoError {
  constructor(message: string) {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionDeniedError';
  }
}

export function errorWithCause(err: unknown): string {
  const e = err as { message?: unknown; cause?: unknown; code?: unknown; hostname?: unknown };
  const message = typeof e.message === 'string' ? e.message : String(err);
  const cause = e.cause as { message?: unknown; code?: unknown; hostname?: unknown } | undefined;
  if (!cause) return message;
  const bits = [
    typeof cause.code === 'string' ? cause.code : undefined,
    typeof cause.hostname === 'string' ? cause.hostname : undefined,
    typeof cause.message === 'string' ? cause.message : undefined,
  ].filter(Boolean);
  return bits.length ? `${message} (${bits.join(': ')})` : message;
}
