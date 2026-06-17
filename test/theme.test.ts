import { describe, it, expect, afterEach } from 'vitest';
import {
  THEMES,
  themeNames,
  detectTheme,
  resolveTheme,
  getTheme,
  setTheme,
  initTheme,
  DEFAULT_THEME,
} from '../src/ui/theme.js';
import { buildThemeCommand } from '../src/agent/commands/theme.js';
import type { CommandHost } from '../src/agent/commands/host.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => setTheme(DEFAULT_THEME));

describe('theme system', () => {
  it('exposes named themes with color tokens', () => {
    expect(themeNames()).toEqual(expect.arrayContaining(['dark', 'light', 'mono', 'high-contrast']));
    expect(THEMES.dark!.user).toBeTruthy();
  });

  it('auto-detects from the environment', () => {
    expect(detectTheme({ NO_COLOR: '1' })).toBe('mono');
    expect(detectTheme({ COLORFGBG: '0;15' })).toBe('light');
    expect(detectTheme({ COLORFGBG: '15;0' })).toBe('dark');
    expect(detectTheme({})).toBe('dark');
  });

  it('resolves unknown names to the default', () => {
    expect(resolveTheme('nope').name).toBe(DEFAULT_THEME);
    expect(resolveTheme('light').name).toBe('light');
  });

  it('sets and initializes the active theme', () => {
    expect(setTheme('light')).toBe(true);
    expect(getTheme().name).toBe('light');
    expect(setTheme('bogus')).toBe(false);
    initTheme(undefined, { NO_COLOR: '1' });
    expect(getTheme().name).toBe('mono');
  });

  it('/theme switches and persists', () => {
    const cfg: Record<string, unknown> = {};
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-theme-'));
    const host = { config: cfg, globalConfigDir: dir } as unknown as CommandHost;
    const cmd = buildThemeCommand(host);
    const res = cmd.run({ args: 'light', state: { provider: 'x', model: 'y' } }) as { message: string };
    expect(getTheme().name).toBe('light');
    expect(cfg.theme).toBe('light');
    expect(res.message).toContain('light');
  });
});
