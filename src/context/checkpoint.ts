/** Checkpoint & session-context assembly helpers (pure; I/O stays in the runtime). */
import { estimateTokens } from './budget.js';

/** Build the checkpoint-writer prompt text. */
export function buildCheckpointPrompt(goal: string | undefined, tasks: string, transcript: string): string {
  return (
    `Write a concise CHECKPOINT of this coding session so it can be resumed later. ` +
    `Use these sections: Intent, Key decisions, Files changed, Open tasks, Next steps.\n\n` +
    `Goal: ${goal ?? '(none)'}\nOpen tasks:\n${tasks || '(none)'}\n\nTranscript:\n${transcript}`
  );
}

/** Assemble the final checkpoint markdown body. */
export function buildCheckpointBody(opts: {
  provider: string;
  model: string;
  agent: string;
  goal?: string;
  tasks: string;
  summary: string;
  transcript: string;
}): string {
  return [
    `# Checkpoint — ${new Date().toISOString()}`,
    `Provider/model: ${opts.provider} · ${opts.model} · agent: ${opts.agent}`,
    opts.goal ? `Goal: ${opts.goal}` : '',
    opts.tasks ? `\n## Open tasks\n${opts.tasks}` : '',
    opts.summary.trim() ? `\n${opts.summary.trim()}` : `\n## Recent activity\n${opts.transcript}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ContextSection {
  title: string;
  body: string;
  cap: number;
  weight: number;
}

/**
 * Token-budgeted, importance-ranked session context block. Higher weight is injected first;
 * each section is truncated to its own cap, and the total is kept within `budgetTokens`.
 */
export function buildSessionContextBlock(sections: ContextSection[], budgetTokens = 4000): string {
  let used = 0;
  const out: string[] = [];
  for (const s of sections.filter((x) => x.body).sort((a, b) => b.weight - a.weight)) {
    const text = s.body.slice(0, s.cap);
    const cost = estimateTokens(text);
    if (used + cost > budgetTokens) continue;
    used += cost;
    out.push(`## ${s.title}\n${text}`);
  }
  return out.length ? `# Session memory (auto-injected, budgeted)\n${out.join('\n\n')}` : '';
}
