import { describe, it, expect } from 'vitest';
import { statusIcon, collapseOutput, formatToolResult } from '../src/ui/toolview.js';

describe('tool display', () => {
  it('maps lifecycle states to icons', () => {
    expect(statusIcon('running')).toBe('⏺');
    expect(statusIcon('success')).toBe('✓');
    expect(statusIcon('error')).toBe('✗');
  });

  it('collapses long output and reports hidden lines', () => {
    const out = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const c = collapseOutput(out, 5);
    expect(c.text.split('\n')).toHaveLength(5);
    expect(c.hiddenLines).toBe(15);
    expect(collapseOutput('short', 5).hiddenLines).toBe(0);
  });

  it('formats a result with icon and collapse footer', () => {
    const out = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const ok = formatToolResult(out, false, 5);
    expect(ok.startsWith('✓')).toBe(true);
    expect(ok).toMatch(/\+15 more line\(s\)/);
    const err = formatToolResult('boom', true, 5);
    expect(err.startsWith('✗')).toBe(true);
    expect(formatToolResult('', false)).toContain('(no output)');
  });
});
