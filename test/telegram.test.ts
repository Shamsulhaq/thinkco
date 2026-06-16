import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelegramFrontend } from '../src/frontends/telegram/index.js';
import { redactSecrets } from '../src/frontends/telegram/redact.js';
import type { InlineButton, TelegramTransport, TelegramUpdate } from '../src/frontends/telegram/transport.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { FakeProvider, type ScriptedTurn } from '../src/providers/fake.js';
import { loadConfig } from '../src/config/index.js';

class MockTransport implements TelegramTransport {
  messages: Array<{ chatId: number; text: string }> = [];
  edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  buttons: Array<{ chatId: number; text: string; buttons: InlineButton[] }> = [];
  answered: string[] = [];
  private nextId = 1;
  handler?: (u: TelegramUpdate) => void;

  async sendMessage(chatId: number, text: string): Promise<number> {
    this.messages.push({ chatId, text });
    return this.nextId++;
  }
  async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
    this.edits.push({ chatId, messageId, text });
  }
  async sendButtons(chatId: number, text: string, buttons: InlineButton[]): Promise<number> {
    this.buttons.push({ chatId, text, buttons });
    return this.nextId++;
  }
  async answerCallback(callbackId: string): Promise<void> {
    this.answered.push(callbackId);
  }
  onUpdate(handler: (u: TelegramUpdate) => void): void {
    this.handler = handler;
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

function buildFrontend(transport: MockTransport, allowlist: number[], script: ScriptedTurn[], cwd: string) {
  const registry = new ProviderRegistry();
  registry.register('scripted', () => new FakeProvider({ script, echo: true }));
  const config = loadConfig({ globalDir: cwd, projectDir: cwd, overrides: { defaultProvider: 'scripted' } });
  return new TelegramFrontend({ transport, config, allowlist, providerRegistry: registry, cwd });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-tg-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('redaction', () => {
  it('redacts API keys and tokens', () => {
    expect(redactSecrets('key sk-abcdefghijklmnopqrstuv')).toContain('[redacted-openai-key]');
    expect(redactSecrets('tok 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678')).toContain('[redacted-telegram-token]');
  });
});

describe('TelegramFrontend security + messaging', () => {
  it('ignores non-allowlisted users', async () => {
    const t = new MockTransport();
    const fe = buildFrontend(t, [111], [{ text: ['hello'] }], dir);
    await fe.handleUpdate({ kind: 'message', chatId: 5, userId: 999, text: 'hi' });
    expect(t.messages).toEqual([]);
    expect(t.buttons).toEqual([]);
  });

  it('responds to allowlisted users with (redacted) output', async () => {
    const t = new MockTransport();
    const fe = buildFrontend(t, [111], [{ text: ['response with sk-abcdefghijklmnopqrstuv'] }], dir);
    await fe.handleUpdate({ kind: 'message', chatId: 5, userId: 111, text: 'hi' });
    const all = [...t.messages.map((m) => m.text), ...t.edits.map((e) => e.text)].join(' ');
    expect(all).toContain('[redacted-openai-key]');
    expect(all).not.toContain('sk-abcdefghijklmnopqrstuv');
  });

  it('handles slash commands via the shared runtime (e.g. /help)', async () => {
    const t = new MockTransport();
    const fe = buildFrontend(t, [111], [], dir);
    await fe.handleUpdate({ kind: 'message', chatId: 5, userId: 111, text: '/help' });
    const all = [...t.messages.map((m) => m.text), ...t.edits.map((e) => e.text)].join(' ');
    expect(all).toMatch(/\/models|\/mode|\/exit/);
  });

  it('requires inline-button approval for tool use and runs on approve', async () => {
    const t = new MockTransport();
    const fe = buildFrontend(
      t,
      [111],
      [
        { toolCalls: [{ id: 'w1', name: 'write', input: { path: 'remote.txt', content: 'from telegram' } }] },
        { text: ['done'] },
      ],
      dir,
    );

    // Start handling (will block awaiting approval).
    const p = fe.handleUpdate({ kind: 'message', chatId: 5, userId: 111, text: 'write a file' });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.buttons.length).toBe(1); // approval prompt shown
    expect(t.buttons[0]!.buttons.map((b) => b.data)).toEqual(['approve', 'deny']);

    // Approve via callback.
    await fe.handleUpdate({ kind: 'callback', chatId: 5, userId: 111, data: 'approve', callbackId: 'cb1' });
    await p;

    expect(existsSync(join(dir, 'remote.txt'))).toBe(true);
    expect(t.answered).toContain('cb1');
  });

  it('denies tool use when the user taps deny', async () => {
    const t = new MockTransport();
    const fe = buildFrontend(
      t,
      [111],
      [
        { toolCalls: [{ id: 'w1', name: 'write', input: { path: 'blocked.txt', content: 'nope' } }] },
        { text: ['ok'] },
      ],
      dir,
    );
    const p = fe.handleUpdate({ kind: 'message', chatId: 7, userId: 111, text: 'write a file' });
    await new Promise((r) => setTimeout(r, 20));
    await fe.handleUpdate({ kind: 'callback', chatId: 7, userId: 111, data: 'deny', callbackId: 'cb2' });
    await p;
    expect(existsSync(join(dir, 'blocked.txt'))).toBe(false);
  });

  it('shows a friendly activity indicator while a tool runs', async () => {
    const t = new MockTransport();
    // glob is read-risk → runs without approval even under strictRemote.
    const fe = buildFrontend(
      t,
      [111],
      [{ toolCalls: [{ id: 'g1', name: 'glob', input: { pattern: '*' } }] }, { text: ['found them'] }],
      dir,
    );
    await fe.handleUpdate({ kind: 'message', chatId: 8, userId: 111, text: 'find files' });
    const all = [...t.messages.map((m) => m.text), ...t.edits.map((e) => e.text)].join(' | ');
    expect(all).toContain('Searching the code'); // activity verb for glob
    expect(all).toContain('found them'); // final answer
  });

  it('queues messages while busy and replies one by one', async () => {
    const t = new MockTransport();
    const fe = buildFrontend(
      t,
      [111],
      [
        { toolCalls: [{ id: 'w1', name: 'write', input: { path: 'q.txt', content: 'x' } }] },
        { text: ['first done'] },
        { text: ['second done'] },
      ],
      dir,
    );
    // msg1 blocks on approval (busy).
    const p1 = fe.handleUpdate({ kind: 'message', chatId: 9, userId: 111, text: 'msg1' });
    await new Promise((r) => setTimeout(r, 20));
    // msg2 arrives while busy → should be queued, not rejected.
    await fe.handleUpdate({ kind: 'message', chatId: 9, userId: 111, text: 'msg2' });
    expect(t.messages.some((m) => /Queued/.test(m.text))).toBe(true);
    // Approve msg1; the drain loop then processes msg2.
    await fe.handleUpdate({ kind: 'callback', chatId: 9, userId: 111, data: 'approve', callbackId: 'cb' });
    await p1;
    const all = [...t.messages.map((m) => m.text), ...t.edits.map((e) => e.text)].join(' | ');
    expect(all).toContain('first done');
    expect(all).toContain('second done');
  });
});
