import { describe, it, expect } from 'vitest';
import { formatTray } from '../src/ui/tray.js';

describe('activity tray', () => {
  it('shows provider/model/mode and omits empty segments when idle', () => {
    const line = formatTray({ provider: 'anthropic', model: 'claude', mode: 'default', inTokens: 0, outTokens: 0, busy: false });
    expect(line).toBe('anthropic · claude · default');
  });

  it('adds tokens, cost, work, and queue segments', () => {
    const line = formatTray({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'auto',
      inTokens: 100,
      outTokens: 50,
      busy: true,
      elapsedSec: 12.4,
      toolCount: 2,
      queued: 1,
      costUSD: 0.0123,
    });
    expect(line).toContain('100/50 tok');
    expect(line).toContain('~$0.0123');
    expect(line).toContain('working 12s · 2 tools');
    expect(line).toContain('1 queued');
  });

  it('shows waiting state instead of working state for active prompts', () => {
    const line = formatTray({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'default',
      inTokens: 0,
      outTokens: 0,
      busy: true,
      elapsedSec: 20,
      waitingFor: 'waiting for selection',
    });
    expect(line).toContain('waiting for selection');
    expect(line).not.toContain('working 20s');
  });
});
