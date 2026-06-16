import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/index.js';

function tmpConfigDir(content: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'thinkco-cfg-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(content));
  return dir;
}

describe('loadConfig', () => {
  const created: string[] = [];
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    created.forEach((d) => rmSync(d, { recursive: true, force: true }));
    created.length = 0;
    process.env = { ...savedEnv };
  });

  it('returns defaults when no config files exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'thinkco-empty-'));
    created.push(empty);
    const cfg = loadConfig({ globalDir: empty, projectDir: empty });
    expect(cfg.defaultProvider).toBe('anthropic');
    expect(cfg.logLevel).toBe('info');
    expect(cfg.permissions.sandbox).toBe(false);
  });

  it('project config overrides global config', () => {
    const globalDir = tmpConfigDir({ defaultProvider: 'anthropic', logLevel: 'warn' });
    const projectDir = tmpConfigDir({ defaultProvider: 'openai' });
    created.push(globalDir, projectDir);
    const cfg = loadConfig({ globalDir, projectDir });
    expect(cfg.defaultProvider).toBe('openai'); // overridden
    expect(cfg.logLevel).toBe('warn'); // inherited from global
  });

  it('overrides take highest precedence', () => {
    const globalDir = tmpConfigDir({ defaultProvider: 'anthropic' });
    created.push(globalDir);
    const cfg = loadConfig({ globalDir, projectDir: globalDir, overrides: { defaultProvider: 'ollama' } });
    expect(cfg.defaultProvider).toBe('ollama');
  });

  it('deep-merges provider config', () => {
    const globalDir = tmpConfigDir({ providers: { openai: { defaultModel: 'gpt-4o' } } });
    const projectDir = tmpConfigDir({ providers: { openai: { baseUrl: 'http://localhost' } } });
    created.push(globalDir, projectDir);
    const cfg = loadConfig({ globalDir, projectDir });
    expect(cfg.providers.openai?.defaultModel).toBe('gpt-4o');
    expect(cfg.providers.openai?.baseUrl).toBe('http://localhost');
  });

  it('applies env var API key fallback', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    const empty = mkdtempSync(join(tmpdir(), 'thinkco-env-'));
    created.push(empty);
    const cfg = loadConfig({ globalDir: empty, projectDir: empty });
    expect(cfg.providers.anthropic?.apiKey).toBe('sk-test-123');
  });

  it('throws ConfigError on invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-bad-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{ not valid json');
    created.push(dir);
    expect(() => loadConfig({ globalDir: dir, projectDir: dir })).toThrow();
  });
});
