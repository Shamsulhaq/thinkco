import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/agent/prompt.js';

describe('buildSystemPrompt', () => {
  it('includes behavior rules and environment', () => {
    const p = buildSystemPrompt({ cwd: process.cwd(), toolNames: ['read', 'write', 'shell'] });
    expect(p).toMatch(/agentic coding assistant/i);
    expect(p).toMatch(/ACT, don't just suggest/);
    expect(p).toContain('Working directory:');
    expect(p).toContain('Tools available: read, write, shell');
  });

  it('includes memory and skills when provided', () => {
    const p = buildSystemPrompt({
      cwd: process.cwd(),
      memory: { sources: ['AGENT.md'], content: 'PROJECT_RULES_HERE' },
      skillsCatalog: 'Available skills: foo',
    });
    expect(p).toContain('PROJECT_RULES_HERE');
    expect(p).toContain('Available skills: foo');
  });

  it('adds a remote note when remote', () => {
    const p = buildSystemPrompt({ cwd: process.cwd(), remote: true });
    expect(p).toMatch(/Remote session/);
  });
});
