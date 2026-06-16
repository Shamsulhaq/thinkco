import { describe, it, expect } from 'vitest';
import { thinkcoLogo, LOGO_WIDTH } from '../src/ui/banner.js';
import { sideBySide, visibleLength } from '../src/ui/ansi.js';

describe('thinkcoLogo', () => {
  it('renders the full 6-row art on a wide terminal', () => {
    const logo = thinkcoLogo(200);
    expect(logo.split('\n')).toHaveLength(6);
    expect(logo).toContain('█');
  });

  it('falls back to a compact single-line mark on a narrow terminal', () => {
    const logo = thinkcoLogo(10);
    expect(logo.split('\n')).toHaveLength(1);
    expect(logo).toContain('thinkco');
  });

  it('exposes a positive logo width', () => {
    expect(LOGO_WIDTH).toBeGreaterThan(40);
  });
});

describe('sideBySide', () => {
  it('places blocks next to each other on every row, centering the shorter one', () => {
    const left = 'A\nA\nA\nA'; // 4 rows
    const right = 'B\nB'; // 2 rows
    const out = sideBySide(left, right, 2).split('\n');
    expect(out).toHaveLength(4);
    // the right block is centered, so it appears on the middle rows, not the first
    expect(out.some((r) => /A\s+B/.test(r))).toBe(true);
    expect(visibleLength(out[0]!)).toBeGreaterThan(0);
  });
});
