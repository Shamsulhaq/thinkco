/**
 * Theme system for the TUI. Centralizes the previously-hardcoded Ink colors into named token
 * sets, supports `/theme` switching, and auto-detects light/dark from the terminal background.
 */
export interface Theme {
  name: string;
  user: string;
  assistant: string;
  tool: string;
  toolResult: string;
  error: string;
  notice: string;
  accent: string;
  border: string;
  dim: string;
}

export const THEMES: Record<string, Theme> = {
  dark: {
    name: 'dark',
    user: 'cyan',
    assistant: 'magenta',
    tool: 'green',
    toolResult: 'gray',
    error: 'red',
    notice: 'gray',
    accent: 'cyan',
    border: 'cyan',
    dim: 'gray',
  },
  light: {
    name: 'light',
    user: 'blue',
    assistant: 'magenta',
    tool: 'green',
    toolResult: 'black',
    error: 'red',
    notice: 'blackBright',
    accent: 'blue',
    border: 'blue',
    dim: 'blackBright',
  },
  'high-contrast': {
    name: 'high-contrast',
    user: 'whiteBright',
    assistant: 'yellowBright',
    tool: 'greenBright',
    toolResult: 'white',
    error: 'redBright',
    notice: 'white',
    accent: 'cyanBright',
    border: 'whiteBright',
    dim: 'white',
  },
  mono: {
    name: 'mono',
    user: 'white',
    assistant: 'white',
    tool: 'white',
    toolResult: 'gray',
    error: 'white',
    notice: 'gray',
    accent: 'white',
    border: 'white',
    dim: 'gray',
  },
};

export const DEFAULT_THEME = 'dark';

/** Available theme names. */
export function themeNames(): string[] {
  return Object.keys(THEMES);
}

/**
 * Auto-detect a sensible theme from the environment:
 * - `NO_COLOR` → `mono`
 * - `COLORFGBG` background luminance → `light` or `dark`
 * - otherwise `dark`.
 */
export function detectTheme(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NO_COLOR !== undefined) return 'mono';
  const fgbg = env.COLORFGBG;
  if (fgbg) {
    const parts = fgbg.split(';');
    const bg = Number(parts[parts.length - 1]);
    // ANSI colors 0-6 and 8 are dark backgrounds; 7 and 9-15 tend to be light.
    if (!Number.isNaN(bg) && (bg === 7 || bg >= 9)) return 'light';
  }
  return 'dark';
}

/** Resolve a theme by name, falling back to the default. */
export function resolveTheme(name: string | undefined): Theme {
  if (name && THEMES[name]) return THEMES[name]!;
  return THEMES[DEFAULT_THEME]!;
}

let active: Theme = THEMES[DEFAULT_THEME]!;

export function getTheme(): Theme {
  return active;
}

/** Set the active theme by name. Returns true if the name was known. */
export function setTheme(name: string): boolean {
  const t = THEMES[name];
  if (!t) return false;
  active = t;
  return true;
}

/** Initialize the active theme from a configured name, else auto-detect. */
export function initTheme(configured?: string, env: NodeJS.ProcessEnv = process.env): Theme {
  active = resolveTheme(configured ?? detectTheme(env));
  return active;
}
