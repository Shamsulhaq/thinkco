import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTelegramCommand, telegramGetMe } from '../src/cli/telegram.js';
import { loadConfig } from '../src/config/index.js';

let dir: string;
const load = () => loadConfig({ globalDir: dir, projectDir: dir });
const saved = () => (existsSync(join(dir, 'config.json')) ? JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) : {});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinkco-tg-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('thinkco telegram command', () => {
  it('set-token saves the token to global config', async () => {
    const code = await runTelegramCommand(['telegram', 'set-token', '999:XYZ'], load(), dir);
    expect(code).toBe(0);
    expect(saved().telegram.token).toBe('999:XYZ');
  });

  it('add-user appends + dedupes numeric ids; remove-user drops them; token is preserved', async () => {
    await runTelegramCommand(['telegram', 'set-token', '999:XYZ'], load(), dir);
    await runTelegramCommand(['telegram', 'add-user', '111', '222', '111'], load(), dir);
    expect(saved().telegram.allowlist).toEqual([111, 222]);

    await runTelegramCommand(['telegram', 'add-user', '333'], load(), dir);
    expect(saved().telegram.allowlist).toEqual([111, 222, 333]);

    await runTelegramCommand(['telegram', 'remove-user', '222'], load(), dir);
    expect(saved().telegram.allowlist).toEqual([111, 333]);
    // token survived the allowlist edits (deep-merge)
    expect(saved().telegram.token).toBe('999:XYZ');
  });

  it('parses comma/space separated ids', async () => {
    await runTelegramCommand(['telegram', 'add-user', '10,20 30'], load(), dir);
    expect(saved().telegram.allowlist).toEqual([10, 20, 30]);
  });

  it('rejects non-numeric ids and missing token', async () => {
    expect(await runTelegramCommand(['telegram', 'add-user', 'abc'], load(), dir)).toBe(1);
    expect(await runTelegramCommand(['telegram', 'set-token'], load(), dir)).toBe(1);
  });

  it('status returns 0 without writing config', async () => {
    const code = await runTelegramCommand(['telegram', 'status'], load(), dir);
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
  });

  it('unknown subcommand returns non-zero usage', async () => {
    expect(await runTelegramCommand(['telegram', 'frobnicate'], load(), dir)).toBe(1);
  });
});

describe('telegram connectivity check', () => {
  const okFetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ ok: true, result: { id: 42, username: 'mybot', first_name: 'My Bot' } }) }) as unknown as Response) as unknown as typeof fetch;
  const badFetch = (async () =>
    ({ ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) }) as unknown as Response) as unknown as typeof fetch;

  it('telegramGetMe returns the bot identity on success', async () => {
    const me = await telegramGetMe('123:ABC', okFetch);
    expect(me.username).toBe('mybot');
    expect(me.id).toBe(42);
  });

  it('telegramGetMe throws with the API description on failure', async () => {
    await expect(telegramGetMe('123:ABC', badFetch)).rejects.toThrow(/Unauthorized/);
  });

  it('test subcommand reports success/failure exit codes', async () => {
    const cfg = loadConfig({
      globalDir: dir,
      projectDir: dir,
      overrides: { telegram: { token: '123:ABC', allowlist: [111] } },
    });
    expect(await runTelegramCommand(['telegram', 'test'], cfg, dir, okFetch)).toBe(0);
    expect(await runTelegramCommand(['telegram', 'test'], cfg, dir, badFetch)).toBe(1);
  });

  it('test subcommand fails fast with no token', async () => {
    const cfg = loadConfig({ globalDir: dir, projectDir: dir });
    expect(await runTelegramCommand(['telegram', 'test'], cfg, dir, okFetch)).toBe(1);
  });
});
