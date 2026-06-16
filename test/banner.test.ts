import { describe, it, expect } from 'vitest';
import { thinkcoLogo, LOGO_WIDTH } from '../src/ui/banner.js';

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
