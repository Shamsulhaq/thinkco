/**
 * Tokenizer abstraction behind the budget interface. Defaults to a dependency-free heuristic
 * (~4 chars/token) so offline/local always works; `initTokenizer()` upgrades to a real BPE
 * tokenizer (the optional `gpt-tokenizer` dependency) for materially more accurate counts.
 */
export interface Tokenizer {
  count(text: string): number;
}

/** Dependency-free fallback: ~4 characters per token. */
export const heuristicTokenizer: Tokenizer = {
  count: (text) => (text ? Math.ceil(text.length / 4) : 0),
};

let active: Tokenizer = heuristicTokenizer;
let initPromise: Promise<Tokenizer> | undefined;

/** The active tokenizer (heuristic until `initTokenizer()` upgrades it). */
export function getTokenizer(): Tokenizer {
  return active;
}

/** Override the active tokenizer (pass undefined to reset to the heuristic). */
export function setTokenizer(t: Tokenizer | undefined): void {
  active = t ?? heuristicTokenizer;
}

/** Count tokens with the active tokenizer. */
export function countTokens(text: string): number {
  return active.count(text);
}

/**
 * Try to upgrade to a real BPE tokenizer. Loads the optional `gpt-tokenizer` package; if it is
 * not installed (or fails to load), the heuristic remains active. Idempotent.
 */
export async function initTokenizer(): Promise<Tokenizer> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = (await import('gpt-tokenizer')) as { encode?: (t: string) => number[] };
      if (typeof mod.encode === 'function') {
        const encode = mod.encode;
        active = { count: (text) => (text ? encode(text).length : 0) };
      }
    } catch {
      active = heuristicTokenizer;
    }
    return active;
  })();
  return initPromise;
}
