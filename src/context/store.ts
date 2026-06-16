/** Persistent cross-session memory: project knowledge, scratch notes, and state checkpoints. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface MemorySnapshot {
  memory: string; // MEMORY.md — durable project knowledge/rules/decisions
  notes: string; // notes.md — scratch area
  checkpoint: string; // checkpoint.md — latest state snapshot
}

/** Reads/writes the `.thinkco/memory/` files for a project. */
export class MemoryStore {
  readonly dir: string;
  constructor(cwd: string) {
    this.dir = join(cwd, '.thinkco', 'memory');
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  private read(name: string): string {
    try {
      return existsSync(this.path(name)) ? readFileSync(this.path(name), 'utf8').trim() : '';
    } catch {
      return '';
    }
  }

  private write(name: string, text: string): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(name), text);
  }

  memory(): string {
    return this.read('MEMORY.md');
  }
  notes(): string {
    return this.read('notes.md');
  }
  checkpoint(): string {
    return this.read('checkpoint.md');
  }

  setMemory(text: string): void {
    this.write('MEMORY.md', text.trim() + '\n');
  }
  setCheckpoint(text: string): void {
    this.write('checkpoint.md', text.trim() + '\n');
  }
  setNotes(text: string): void {
    this.write('notes.md', text.trim() + '\n');
  }
  appendNote(text: string): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.path('notes.md'), `${text.trim()}\n`);
  }

  snapshot(): MemorySnapshot {
    return { memory: this.memory(), notes: this.notes(), checkpoint: this.checkpoint() };
  }

  /** True if any memory content exists (used to decide whether to inject on resume). */
  hasContent(): boolean {
    const s = this.snapshot();
    return Boolean(s.memory || s.notes || s.checkpoint);
  }
}

/** Write a file, creating parent dirs. */
export function writeFileEnsured(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
