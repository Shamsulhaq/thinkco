/** Interactive arrow-key selection menu (up/down/enter/esc). Falls back to null on non-TTY. */
import { emitKeypressEvents } from 'node:readline';
import { c } from './ansi.js';

export interface SelectControls {
  pause: () => void;
  resume: () => void;
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * Show a selectable list. Returns the chosen item, or null if cancelled / non-interactive.
 * `controls` lets us pause/resume an existing readline interface during selection.
 */
export function promptSelect(
  title: string,
  items: string[],
  current = 0,
  controls?: SelectControls,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<string | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY || items.length === 0) return Promise.resolve(null);

  controls?.pause();
  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  stdin.resume();

  let index = Math.min(Math.max(current, 0), items.length - 1);
  const totalLines = items.length + 1;
  let firstRender = true;

  const render = (): void => {
    if (!firstRender) write(`\x1b[${totalLines}A`);
    firstRender = false;
    write('\x1b[0J'); // clear from cursor down
    write(`${c.dim(title)} ${c.dim('(↑/↓, Enter to select, Esc to cancel)')}\n`);
    items.forEach((item, i) => {
      if (i === index) write(`${c.cyan('❯')} ${c.cyan(c.bold(item))}\n`);
      else write(`  ${item}\n`);
    });
  };

  write(HIDE_CURSOR);
  render();

  return new Promise<string | null>((resolve) => {
    const cleanup = (result: string | null): void => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(wasRaw);
      // Clear the menu and show cursor.
      write(`\x1b[${totalLines}A\x1b[0J`);
      write(SHOW_CURSOR);
      controls?.resume();
      resolve(result);
    };

    const onKey = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (!key) return;
      if (key.name === 'up' || key.name === 'k') {
        index = (index - 1 + items.length) % items.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        index = (index + 1) % items.length;
        render();
      } else if (key.name === 'return') {
        cleanup(items[index]!);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup(null);
      }
    };

    stdin.on('keypress', onKey);
  });
}
