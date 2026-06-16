import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliFrontend } from '../src/frontends/cli.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SessionStore } from '../src/agent/session.js';
import { RecordingSink } from '../src/agent/output.js';
import { loadConfig } from '../src/config/index.js';

function frontend(dir: string) {
  const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake' } });
  return new CliFrontend({
    config,
    providerRegistry: new ProviderRegistry(),
    tools: new ToolRegistry(),
    sessionStore: new SessionStore(join(dir, 'sessions')),
  });
}

describe('CliFrontend.processLine', () => {
  it('runs an agent turn and persists a session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-fe-'));
    try {
      const fe = frontend(dir);
      const sink = new RecordingSink();
      const { exit } = await fe.processLine('hello there', sink);
      expect(exit).toBe(false);
      expect(sink.fullText).toContain('hello there'); // fake echoes
      const store = new SessionStore(join(dir, 'sessions'));
      expect(store.list().length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles /help command without running the agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-fe-'));
    try {
      const fe = frontend(dir);
      const sink = new RecordingSink();
      await fe.processLine('/help', sink);
      expect(sink.notices.join('\n')).toMatch(/\/help/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits on /exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-fe-'));
    try {
      const fe = frontend(dir);
      const { exit } = await fe.processLine('/exit', new RecordingSink());
      expect(exit).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
