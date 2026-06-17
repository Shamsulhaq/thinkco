import { describe, it, expect } from 'vitest';
import { approvalScopeOptions, isDangerous, defaultApprovalIndex, describeToolCall } from '../src/ui/approval.js';

describe('approval UX helpers', () => {
  it('offers once/session/always/deny scopes', () => {
    const opts = approvalScopeOptions('shell');
    expect(opts.map((o) => o.scope)).toEqual(['once', 'session', 'always', 'deny']);
    expect(opts[2]!.label).toContain('shell');
  });

  it('defaults dangerous actions to deny (safer flow)', () => {
    expect(isDangerous('execute')).toBe(true);
    expect(isDangerous('read')).toBe(false);
    expect(defaultApprovalIndex('execute', 4)).toBe(3); // deny
    expect(defaultApprovalIndex('read', 4)).toBe(0); // yes-once
  });

  it('describes a tool call with its primary detail and extras', () => {
    expect(describeToolCall({ id: '1', name: 'shell', input: { command: 'rm -rf x' } })).toContain('shell: rm -rf x');
    const d = describeToolCall({ id: '2', name: 'write', input: { path: 'a.txt', mode: 644 } });
    expect(d).toContain('write: a.txt');
    expect(d).toContain('mode=644');
  });
});
