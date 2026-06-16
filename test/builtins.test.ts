import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extendedCommands, type BuiltinDeps } from '../src/cli/builtins.js';
import { SessionStore, newSession, type Session } from '../src/agent/session.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/core/index.js';
import { SkillRegistry } from '../src/skills/registry.js';
import { loadConfig } from '../src/config/index.js';
import type { Message } from '../src/types/index.js';
import type { SlashCommand } from '../src/agent/commands.js';

let dir: string;
let messages: Message[];
let session: Session;

function deps(): BuiltinDeps {
  const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake' } });
  const tools = new ToolRegistry();
  registerCoreTools(tools);
  return {
    cwd: dir,
    config,
    state: { provider: 'fake', model: 'fake-1' },
    getMessages: () => messages,
    setMessages: (m) => {
      messages = m;
    },
    sessionStore: new SessionStore(join(dir, 'sessions')),
    getSession: () => session,
    setSession: (s) => {
      session = s;
    },
    providerRegistry: new ProviderRegistry(),
    tools,
    skills: new SkillRegistry(),
    getMode: () => 'default',
  };
}

function cmd(list: SlashCommand[], name: string): SlashCommand {
  const c = list.find((x) => x.name === name);
  if (!c) throw new Error(`no command ${name}`);
  return c;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-builtins-'));
  messages = [];
  session = newSession('fake', 'fake-1');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('extended built-in commands', () => {
  it('/init generates AGENT.md', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'vitest' } }));
    const list = extendedCommands(deps());
    const res = await cmd(list, 'init').run({ args: '', state: { provider: 'fake', model: 'fake-1' } });
    expect(res.message).toMatch(/Created AGENT\.md/);
    expect(existsSync(join(dir, 'AGENT.md'))).toBe(true);
    expect(readFileSync(join(dir, 'AGENT.md'), 'utf8')).toContain('demo');
  });

  it('/init does not overwrite an existing AGENT.md', async () => {
    writeFileSync(join(dir, 'AGENT.md'), 'keep me');
    const list = extendedCommands(deps());
    await cmd(list, 'init').run({ args: '', state: { provider: 'fake', model: 'fake-1' } });
    expect(readFileSync(join(dir, 'AGENT.md'), 'utf8')).toBe('keep me');
  });

  it('/doctor reports provider/model/tools', async () => {
    const list = extendedCommands(deps());
    const res = await cmd(list, 'doctor').run({ args: '', state: { provider: 'fake', model: 'fake-1' } });
    expect(res.message).toMatch(/provider:\s+fake/);
    expect(res.message).toMatch(/tools:\s+\d+/);
  });

  it('/config shows config locations', async () => {
    const list = extendedCommands(deps());
    const res = await cmd(list, 'config').run({ args: '', state: { provider: 'fake', model: 'fake-1' } });
    expect(res.message).toMatch(/Global config/);
  });

  it('/rename names the session', async () => {
    const list = extendedCommands(deps());
    await cmd(list, 'rename').run({ args: 'my task', state: { provider: 'fake', model: 'fake-1' } });
    expect(session.name).toBe('my task');
  });

  it('/compact reports nothing to compact on a short conversation', async () => {
    messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const list = extendedCommands(deps());
    const res = await cmd(list, 'compact').run({ args: '', state: { provider: 'fake', model: 'fake-1' } });
    expect(res.message).toMatch(/Nothing to compact/);
  });

  it('/compact summarizes a long conversation (heuristic)', async () => {
    messages = [];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'x'.repeat(50) }] });
    }
    const d = deps();
    // Force heuristic by using a registry without a usable provider for summarize? fake works; provider create ok.
    const list = extendedCommands(d);
    const res = await cmd(list, 'compact').run({ args: 'auth', state: d.state });
    expect(res.message).toMatch(/Compacted 12/);
    expect(messages.length).toBeLessThan(12);
  });

  it('/resume lists sessions on non-TTY', async () => {
    const store = new SessionStore(join(dir, 'sessions'));
    const s = newSession('fake', 'fake-1');
    store.save(s);
    const list = extendedCommands(deps());
    const res = await cmd(list, 'resume').run({ args: '', state: { provider: 'fake', model: 'fake-1' } });
    expect(res.message).toMatch(/Sessions:|No saved sessions/);
  });
});
