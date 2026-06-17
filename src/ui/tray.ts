/** Structured activity tray: a single status line summarizing the live session. */
export interface TrayState {
  provider: string;
  model: string;
  mode: string;
  inTokens: number;
  outTokens: number;
  busy: boolean;
  elapsedSec?: number;
  toolCount?: number;
  queued?: number;
  /** Human-readable prompt/wait state that should not look like model/tool work. */
  waitingFor?: string;
  /** Optional estimated session cost (USD). */
  costUSD?: number;
}

/** Build the activity-tray line. Segments are separated by " · " and omit empty parts. */
export function formatTray(s: TrayState): string {
  const parts: string[] = [`${s.provider}`, `${s.model}`, `${s.mode}`];
  if (s.inTokens + s.outTokens > 0) parts.push(`${s.inTokens}/${s.outTokens} tok`);
  if (s.costUSD && s.costUSD > 0) parts.push(`~$${s.costUSD.toFixed(4)}`);
  if (s.waitingFor) {
    parts.push(s.waitingFor);
  } else if (s.busy) {
    let work = `working ${Math.max(0, Math.round(s.elapsedSec ?? 0))}s`;
    if (s.toolCount) work += ` · ${s.toolCount} tool${s.toolCount > 1 ? 's' : ''}`;
    parts.push(work);
  }
  if (s.queued && s.queued > 0) parts.push(`${s.queued} queued`);
  return parts.join(' · ');
}
