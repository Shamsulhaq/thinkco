/** Session persistence using JSON files under .thinkco/sessions/. */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '../types/index.js';

export interface Session {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: Message[];
}

export function newSession(provider: string, model: string, id?: string): Session {
  const now = new Date().toISOString();
  return {
    id: id ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    provider,
    model,
    messages: [],
  };
}

export class SessionStore {
  constructor(
    private readonly dir: string,
    private readonly maxSessions = 50,
  ) {}

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  save(session: Session): void {
    this.ensureDir();
    session.updatedAt = new Date().toISOString();
    writeFileSync(this.pathFor(session.id), JSON.stringify(session, null, 2));
    this.prune();
  }

  /** Keep only the `maxSessions` most recently updated sessions. */
  prune(): void {
    const all = this.list();
    for (const { id } of all.slice(this.maxSessions)) {
      try {
        rmSync(this.pathFor(id), { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  load(id: string): Session | undefined {
    const p = this.pathFor(id);
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, 'utf8')) as Session;
  }

  list(): Array<{ id: string; updatedAt: string }> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = join(this.dir, f);
        return { id: f.replace(/\.json$/, ''), updatedAt: statSync(full).mtime.toISOString() };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  latest(): Session | undefined {
    const [first] = this.list();
    return first ? this.load(first.id) : undefined;
  }
}
