/** thinkco ASCII logo (ANSI Shadow) with a gradient, plus a compact fallback for narrow terminals. */

const ESC = '\x1b[';
const colorOn = (): boolean => process.env.NO_COLOR === undefined;

/** ANSI Shadow rendering of "THINKCO" (each row is the same visible width). */
const LOGO: string[] = [
  '████████╗██╗  ██╗██╗███╗   ██╗██╗  ██╗ ██████╗ ██████╗ ',
  '╚══██╔══╝██║  ██║██║████╗  ██║██║ ██╔╝██╔════╝██╔═══██╗',
  '   ██║   ███████║██║██╔██╗ ██║█████╔╝ ██║     ██║   ██║',
  '   ██║   ██╔══██║██║██║╚██╗██║██╔═██╗ ██║     ██║   ██║',
  '   ██║   ██║  ██║██║██║ ╚████║██║  ██╗╚██████╗╚██████╔╝',
  '   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ',
];

/** 256-color ramp (pink → purple → blue → cyan), one shade per logo row. */
const RAMP = [213, 177, 141, 105, 69, 45];

export const LOGO_WIDTH = Math.max(...LOGO.map((l) => l.length));

function paint(line: string, code: number): string {
  return colorOn() ? `${ESC}38;5;${code}m${line}${ESC}39m` : line;
}

/**
 * Render the thinkco logo. Returns the full gradient art when the terminal is wide enough,
 * otherwise a compact single-line mark so it never wraps and looks broken.
 */
export function thinkcoLogo(columns: number = process.stdout.columns ?? 80): string {
  if (!columns || columns < LOGO_WIDTH + 2) {
    return colorOn() ? `${ESC}38;5;213m✻ thinkco${ESC}39m` : '✻ thinkco';
  }
  return LOGO.map((l, i) => paint(l, RAMP[i] ?? 45)).join('\n');
}
