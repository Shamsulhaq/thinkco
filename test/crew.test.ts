import { describe, it, expect } from 'vitest';
import { formatCrew } from '../src/ui/crew.js';
import type { SubagentEntry } from '../src/agent/commands/host.js';

function entry(over: Partial<SubagentEntry>): SubagentEntry {
  return { id: 'S1', task: 'do thing', status: 'running', controller: new AbortController(), promise: Promise.resolve(), ...over };
}

describe('crew monitor', () => {
  it('reports empty crew', () => {
    expect(formatCrew([])).toMatch(/No sub-agents/);
  });

  it('summarizes counts and per-agent status with icons', () => {
    const out = formatCrew([
      entry({ id: 'S1', status: 'running', task: 'build api' }),
      entry({ id: 'S2', status: 'done', task: 'write tests' }),
      entry({ id: 'S3', status: 'error', task: 'deploy' }),
    ]);
    expect(out).toContain('3 subagent(s)');
    expect(out).toContain('1 running');
    expect(out).toContain('⏺ S1 [running] build api');
    expect(out).toContain('✓ S2 [done]');
    expect(out).toContain('✗ S3 [error]');
  });
});
