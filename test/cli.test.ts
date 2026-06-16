import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../src/cli/index.js';
import { VERSION } from '../src/index.js';

function captureStdout() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return { chunks, restore: () => spy.mockRestore() };
}

describe('cli main', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it('--version prints version', async () => {
    const out = captureStdout();
    const code = await main(['--version']);
    out.restore();
    expect(code).toBe(0);
    expect(out.chunks.join('')).toContain(VERSION);
  });

  it('--help prints usage', async () => {
    const out = captureStdout();
    const code = await main(['--help']);
    out.restore();
    expect(code).toBe(0);
    expect(out.chunks.join('')).toContain('USAGE');
  });

  it('headless --json returns a structured result', async () => {
    const out = captureStdout();
    const code = await main(['-p', 'do something', '--json', '--provider', 'fake']);
    out.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(out.chunks.join('').trim());
    expect(parsed.status).toBe('ok');
    expect(parsed).toHaveProperty('text');
    expect(parsed).toHaveProperty('usage');
  });
});
