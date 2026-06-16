/** ANSI styling helpers + box drawing (no dependencies). */

const ESC = '\x1b[';
const enabled = () => process.env.NO_COLOR === undefined;

function wrap(code: string, close: string, s: string): string {
  return enabled() ? `${ESC}${code}m${s}${ESC}${close}m` : s;
}

export const c = {
  bold: (s: string) => wrap('1', '22', s),
  dim: (s: string) => wrap('2', '22', s),
  italic: (s: string) => wrap('3', '23', s),
  underline: (s: string) => wrap('4', '24', s),
  inverse: (s: string) => wrap('7', '27', s),
  red: (s: string) => wrap('31', '39', s),
  green: (s: string) => wrap('32', '39', s),
  yellow: (s: string) => wrap('33', '39', s),
  blue: (s: string) => wrap('34', '39', s),
  magenta: (s: string) => wrap('35', '39', s),
  cyan: (s: string) => wrap('36', '39', s),
  gray: (s: string) => wrap('90', '39', s),
  orange: (s: string) => wrap('38;5;208', '39', s),
};

/** Visible length of a string, ignoring ANSI escape sequences. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Place two multi-line blocks next to each other, vertically centering the shorter one. */
export function sideBySide(left: string, right: string, gap = 3): string {
  const l = left.split('\n');
  const r = right.split('\n');
  const lw = Math.max(...l.map(visibleLength));
  const rows = Math.max(l.length, r.length);
  const lOff = Math.floor((rows - l.length) / 2);
  const rOff = Math.floor((rows - r.length) / 2);
  const spacer = ' '.repeat(gap);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const li = i - lOff;
    const ri = i - rOff;
    const ltext = li >= 0 && li < l.length ? l[li]! : '';
    const rtext = ri >= 0 && ri < r.length ? r[ri]! : '';
    const pad = ' '.repeat(Math.max(0, lw - visibleLength(ltext)));
    out.push(ltext + pad + spacer + rtext);
  }
  return out.join('\n');
}

export const CLEAR_LINE = '\r\x1b[2K';

/** Draw a rounded box around the given (plain) lines. */
export function box(lines: string[], opts: { color?: (s: string) => string; padding?: number } = {}): string {
  const pad = opts.padding ?? 1;
  const color = opts.color ?? c.gray;
  const width = Math.max(...lines.map((l) => visibleLength(l))) + pad * 2;
  const top = color('╭' + '─'.repeat(width) + '╮');
  const bottom = color('╰' + '─'.repeat(width) + '╯');
  const body = lines.map((l) => {
    const space = ' '.repeat(pad);
    const fill = ' '.repeat(Math.max(0, width - visibleLength(l) - pad * 2));
    return `${color('│')}${space}${l}${fill}${space}${color('│')}`;
  });
  return [top, ...body, bottom].join('\n');
}
