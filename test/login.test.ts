import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRuntime, type RuntimeUI } from '../src/agent/runtime.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SessionStore } from '../src/agent/session.js';
import { loadConfig } from '../src/config/index.js';
import { RecordingSink } from '../src/agent/output.js';

let dir: string;
const realFetch = globalThis.fetch;

/** A scripted UI that returns queued select/input answers. */
function scriptedUI(selects: (string | null)[], inputs: (string | null)[]): RuntimeUI {
  return {
    approve: async () => true,
    select: async () => selects.shift() ?? null,
    input: async () => inputs.shift() ?? null,
  };
}

function runtime(ui: RuntimeUI, registry = new ProviderRegistry(), extra: Record<string, unknown> = {}) {
  const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake', ...extra } });
  const tools = new ToolRegistry();
  return new AgentRuntime({
    config,
    providerRegistry: registry,
    tools,
    sessionStore: new SessionStore(join(dir, 'sessions')),
    ui,
    cwd: dir,
    globalConfigDir: dir,
    // Persist global config into the temp dir so the test doesn't touch the real home.
    auditPath: join(dir, 'audit.log'),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-login-'));
  // Avoid live network from listModels during /login model discovery.
  globalThis.fetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'm1' }, { id: 'm2' }] }) }) as unknown as Response) as unknown as typeof fetch;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

describe('/login command', () => {
  it('reports unsupported when the UI has no input', async () => {
    const rt = runtime({ approve: async () => true, select: async () => 'openai' });
    const sink = new RecordingSink();
    await rt.handleInput('/login', sink);
    expect(sink.notices.join(' ')).toMatch(/only available in an interactive terminal/);
  });

  it('sets an API key for a known provider and switches to it', async () => {
    const registry = new ProviderRegistry();
    const ui = scriptedUI(['OpenAI'], ['sk-test-key-123']);
    const rt = runtime(ui, registry);
    const sink = new RecordingSink();
    await rt.handleInput('/login', sink);
    expect(rt.state.provider).toBe('openai');
    expect(rt['opts'].config.providers.openai?.apiKey).toBe('sk-test-key-123');
  });

  it('adds a custom OpenAI-compatible provider', async () => {
    const registry = new ProviderRegistry();
    const ui = scriptedUI(
      ['custom (other OpenAI-compatible)'],
      ['groq', 'https://api.groq.com/openai/v1', 'gsk-key'],
    );
    const rt = runtime(ui, registry);
    const sink = new RecordingSink();
    await rt.handleInput('/login', sink);
    expect(rt.state.provider).toBe('groq');
    expect(registry.has('groq')).toBe(true);
    expect(rt['opts'].config.providers.groq?.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('configures a preset provider (OpenRouter) with its base URL', async () => {
    const registry = new ProviderRegistry();
    const ui = scriptedUI(['OpenRouter'], ['or-key']);
    const rt = runtime(ui, registry);
    await rt.handleInput('/login', new RecordingSink());
    expect(rt.state.provider).toBe('openrouter');
    expect(rt['opts'].config.providers.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(rt['opts'].config.providers.openrouter?.apiKey).toBe('or-key');
    expect(registry.has('openrouter')).toBe(true);
  });
});

describe('subagent tool', () => {
  it('is registered into the tool registry by the runtime', () => {
    const tools = new ToolRegistry();
    const config = loadConfig({ globalDir: dir, projectDir: dir, overrides: { defaultProvider: 'fake' } });
    new AgentRuntime({
      config,
      providerRegistry: new ProviderRegistry(),
      tools,
      sessionStore: new SessionStore(join(dir, 'sessions')),
      ui: { approve: async () => true, select: async () => null, input: async () => null },
      cwd: dir,
      globalConfigDir: dir,
    });
    expect(tools.list().some((t) => t.name === 'subagent')).toBe(true);
  });
});

describe('/provider command', () => {
  const withKeys = { providers: { openai: { apiKey: 'k-openai' }, anthropic: { apiKey: 'k-anthropic' } } };

  it('switches to a configured provider by argument', async () => {
    const rt = runtime({ approve: async () => true, select: async () => null, input: async () => null }, new ProviderRegistry(), withKeys);
    await rt.handleInput('/provider openai', new RecordingSink());
    expect(rt.state.provider).toBe('openai');
  });

  it('refuses to switch to a provider with no key', async () => {
    const rt = runtime({ approve: async () => true, select: async () => null, input: async () => null });
    const sink = new RecordingSink();
    await rt.handleInput('/provider openai', sink);
    expect(rt.state.provider).toBe('fake');
    expect(sink.notices.join(' ')).toMatch(/has no API key configured/);
  });

  it('rejects an unknown provider with the known list', async () => {
    const rt = runtime({ approve: async () => true, select: async () => null, input: async () => null });
    const sink = new RecordingSink();
    await rt.handleInput('/provider nope', sink);
    expect(rt.state.provider).not.toBe('nope');
    expect(sink.notices.join(' ')).toMatch(/Unknown provider "nope"/);
  });

  it('lists configured providers and switches via the picker', async () => {
    let offered: string[] = [];
    const ui: RuntimeUI = {
      approve: async () => true,
      select: async (_t, items) => {
        offered = items;
        return items.find((l) => l.startsWith('anthropic')) ?? null;
      },
      input: async () => null,
    };
    const rt = runtime(ui, new ProviderRegistry(), withKeys);
    await rt.handleInput('/provider', new RecordingSink());
    expect(offered.some((l) => l.startsWith('anthropic'))).toBe(true);
    expect(offered.some((l) => l.startsWith('openai'))).toBe(true);
    expect(rt.state.provider).toBe('anthropic');
  });
});

describe('/usage tracking', () => {
  it('records token usage from turns and reports it via /usage', async () => {
    const rt = runtime({ approve: async () => true, select: async () => null });
    await rt.handleInput('hello there', new RecordingSink());

    const totals = rt.usage.totals();
    expect(totals.turns).toBeGreaterThan(0);
    expect(totals.inputTokens + totals.outputTokens).toBeGreaterThan(0);

    const sink = new RecordingSink();
    await rt.handleInput('/usage', sink);
    expect(sink.notices.join(' ')).toMatch(/Usage: [1-9]\d* turn/);
  });
});
