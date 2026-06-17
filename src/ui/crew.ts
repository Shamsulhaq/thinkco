/** Crew (subagent) monitor: render the live status of spawned sub-agents. */
import type { SubagentEntry } from '../agent/commands/host.js';

function icon(status: SubagentEntry['status']): string {
  switch (status) {
    case 'running':
      return '⏺';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'cancelled':
      return '∅';
  }
}

/** A compact multi-line summary of the crew, newest activity first. */
export function formatCrew(entries: readonly SubagentEntry[]): string {
  if (entries.length === 0) return 'No sub-agents have run this session.';
  const running = entries.filter((e) => e.status === 'running').length;
  const header = `Crew: ${entries.length} subagent(s)${running ? `, ${running} running` : ''}`;
  const lines = entries.map((e) => `  ${icon(e.status)} ${e.id} [${e.status}] ${e.task.slice(0, 60)}`);
  return [header, ...lines].join('\n');
}
