/** Config schema + loader. Merges global (~/.config/thinkco) and project (./.thinkco). */
import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { ConfigError } from '../util/errors.js';
import type { LogLevel } from '../util/logger.js';

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
});

export const ConfigSchema = z.object({
  defaultProvider: z.string().default('anthropic'),
  defaultModel: z.string().optional(),
  /** Optional cheaper/separate model used to judge /goal stop conditions (defaults to the active model). */
  judgeModel: z.string().optional(),
  /** Failover chain: on provider failure, switch to the next {provider, model} and retry the turn. */
  fallback: z.array(z.object({ provider: z.string(), model: z.string().optional() })).default([]),
  /** Hard per-session spend cap (USD). Warns at 80%, stops the turn at 100%. 0 = unlimited. */
  maxCostUSD: z.number().nonnegative().default(0),
  /** Opt-in: snapshot the git working tree before each turn so /undo can restore it. */
  autoCommit: z.boolean().default(false),
  /** Map agent (build|plan|compose) or "compose:<phase>" to a model id or "provider:model". */
  modelRouting: z.record(z.string(), z.string()).default({}),
  /** Commands run by the compose `verify` phase (defaults to auto-detected npm build/test). */
  verify: z.array(z.string()).default([]),
  /** Optional embeddings backend for semantic search (defaults: derive from the active provider). */
  embedding: z
    .object({ model: z.string().optional(), baseUrl: z.string().optional(), apiKey: z.string().optional() })
    .optional(),
  logLevel: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
  telemetry: z.boolean().default(false),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  /** Opt-in Claude Code-format plugin directories (their agents load as skills, commands as commands). */
  claudePlugins: z.array(z.string()).default([]),
  permissions: z
    .object({
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
      sandbox: z.boolean().default(false),
      defaultMode: z
        .enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'auto', 'bypass'])
        .default('default'),
    })
    .default({ allow: [], deny: [], sandbox: false, defaultMode: 'default' }),
  mcpServers: z
    .record(
      z.string(),
      z.object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        cwd: z.string().optional(),
        transport: z.enum(['stdio', 'http']).optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default({}),
  hooks: z
    .object({
      'session-start': z.array(z.string()).optional(),
      'session-stop': z.array(z.string()).optional(),
      'pre-tool-use': z.array(z.string()).optional(),
      'post-tool-use': z.array(z.string()).optional(),
      'post-edit': z.array(z.string()).optional(),
    })
    .default({}),
  telegram: z
    .object({
      token: z.string().optional(),
      allowlist: z.array(z.number()).default([]),
    })
    .default({ allowlist: [] }),
  schedule: z
    .array(
      z.object({
        id: z.string(),
        every: z.string(),
        prompt: z.string(),
      }),
    )
    .default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const GLOBAL_CONFIG_DIR = join(homedir(), '.config', 'thinkco');
export const PROJECT_CONFIG_DIR = join(process.cwd(), '.thinkco');

function readJsonIfExists(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`Failed to parse config at ${path}: ${(err as Error).message}`);
  }
}

/** Deep-merge two plain objects (project overrides global). */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface LoadConfigOptions {
  globalDir?: string;
  projectDir?: string;
  /** Inline overrides (e.g. from CLI flags). Highest precedence. */
  overrides?: Record<string, unknown>;
}

/**
 * Load configuration with precedence: defaults < global < project < overrides.
 * Environment variables for API keys are applied as fallbacks.
 */
export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const globalDir = opts.globalDir ?? GLOBAL_CONFIG_DIR;
  const projectDir = opts.projectDir ?? PROJECT_CONFIG_DIR;

  const global = readJsonIfExists(join(globalDir, 'config.json'));
  const project = readJsonIfExists(join(projectDir, 'config.json'));

  let merged = deepMerge(global, project);
  if (opts.overrides) merged = deepMerge(merged, opts.overrides);

  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(`Invalid config: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }

  return applyEnvFallbacks(parsed.data);
}

const ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

function applyEnvFallbacks(config: Config): Config {
  for (const [provider, envKey] of Object.entries(ENV_KEYS)) {
    const envVal = process.env[envKey];
    if (!envVal) continue;
    const existing = config.providers[provider] ?? {};
    if (!existing.apiKey) {
      config.providers[provider] = { ...existing, apiKey: envVal };
    }
  }
  return config;
}

export function resolveLogLevel(config: Config): LogLevel {
  return config.logLevel;
}

/** Persist a partial config patch (e.g. defaultProvider/defaultModel) to the project config file. */
export function saveProjectConfig(
  patch: Record<string, unknown>,
  projectDir: string = PROJECT_CONFIG_DIR,
): void {
  saveConfigTo(join(projectDir, 'config.json'), projectDir, patch);
}

/** Persist a partial config patch to the GLOBAL config file (~/.config/thinkco). */
export function saveGlobalConfig(
  patch: Record<string, unknown>,
  globalDir: string = GLOBAL_CONFIG_DIR,
): void {
  saveConfigTo(join(globalDir, 'config.json'), globalDir, patch);
}

function saveConfigTo(file: string, dir: string, patch: Record<string, unknown>): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const merged = deepMerge(existing, patch);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(merged, null, 2));
  } catch {
    // Persisting preferences must never crash the app.
  }
}

/** True if no global config exists yet (i.e. first launch). */
export function isFirstRun(globalDir: string = GLOBAL_CONFIG_DIR): boolean {
  return !existsSync(join(globalDir, 'config.json'));
}
