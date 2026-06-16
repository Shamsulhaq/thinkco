/** Memory file auto-loading: project conventions injected into the system prompt. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Candidate memory files, in priority order. */
export const MEMORY_FILES = ['AGENT.md', 'AGENTS.md', '.thinkco/memory.md', 'CLAUDE.md'];

export interface LoadedMemory {
  sources: string[];
  content: string;
}

/** Load and concatenate any memory files found under `cwd`. */
export function loadMemory(cwd: string, files: string[] = MEMORY_FILES): LoadedMemory {
  const sources: string[] = [];
  const parts: string[] = [];
  for (const rel of files) {
    const full = join(cwd, rel);
    if (existsSync(full)) {
      try {
        const text = readFileSync(full, 'utf8').trim();
        if (text) {
          sources.push(rel);
          parts.push(`# Project memory: ${rel}\n${text}`);
        }
      } catch {
        // ignore unreadable memory files
      }
    }
  }
  return { sources, content: parts.join('\n\n') };
}

/** Compose a full system prompt from a base prompt and loaded memory. */
export function composeSystemPrompt(base: string, memory: LoadedMemory): string {
  if (!memory.content) return base;
  return `${base}\n\n${memory.content}`;
}
