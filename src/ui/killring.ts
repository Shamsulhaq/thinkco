/** Emacs-style kill-ring and $EDITOR launch for advanced input editing. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A bounded kill-ring supporting kill, yank, and yank-pop (Ctrl-K/Ctrl-Y/Alt-Y semantics). */
export class KillRing {
  private readonly ring: string[] = [];
  private yankIndex = 0;

  constructor(private readonly max = 60) {}

  get entries(): readonly string[] {
    return this.ring;
  }

  /** Add killed text to the front of the ring. */
  kill(text: string): void {
    if (!text) return;
    this.ring.unshift(text);
    if (this.ring.length > this.max) this.ring.pop();
    this.yankIndex = 0;
  }

  /** The most recently killed text (or '' if the ring is empty). */
  yank(): string {
    this.yankIndex = 0;
    return this.ring[0] ?? '';
  }

  /** Rotate to the previous kill (Alt-Y after a yank). */
  yankPop(): string {
    if (this.ring.length === 0) return '';
    this.yankIndex = (this.yankIndex + 1) % this.ring.length;
    return this.ring[this.yankIndex] ?? '';
  }
}

/** Apply a "kill to end of line" at a cursor position; returns the new value + killed text. */
export function killToLineEnd(value: string, cursor: number): { value: string; killed: string } {
  const killed = value.slice(cursor);
  return { value: value.slice(0, cursor), killed };
}

/** Apply a "kill previous word"; returns the new value, new cursor, and killed text. */
export function killWordBackward(value: string, cursor: number): { value: string; cursor: number; killed: string } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const trimmed = before.replace(/\S+\s*$/, '');
  return { value: trimmed + after, cursor: trimmed.length, killed: before.slice(trimmed.length) };
}

/** Resolve the user's preferred editor command. */
export function resolveEditor(env: NodeJS.ProcessEnv = process.env): string {
  return env.VISUAL || env.EDITOR || 'vi';
}

/** Open `$EDITOR` seeded with `initial`, returning the edited text (synchronous). */
export function openInEditor(initial = '', env: NodeJS.ProcessEnv = process.env): string {
  const dir = mkdtempSync(join(tmpdir(), 'thinkco-edit-'));
  const file = join(dir, 'prompt.md');
  try {
    writeFileSync(file, initial, 'utf8');
    const editor = resolveEditor(env);
    spawnSync(editor, [file], { stdio: 'inherit' });
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
