/** Append-only audit log (JSONL) for executed/denied actions. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEntry {
  timestamp: string;
  tool: string;
  input: Record<string, unknown>;
  decision: 'allowed' | 'denied' | 'auto-allowed' | 'auto-denied';
  risk: string;
  reasons: string[];
  /** Origin of the action (e.g. frontend name or remote user id). */
  origin?: string;
}

export interface AuditLogger {
  record(entry: AuditEntry): void;
}

/** Writes audit entries as JSON lines to a file. */
export class FileAuditLog implements AuditLogger {
  constructor(private readonly path: string) {}

  record(entry: AuditEntry): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
    } catch {
      // Auditing must never crash the agent.
    }
  }
}

/** In-memory audit log for tests. */
export class MemoryAuditLog implements AuditLogger {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}
