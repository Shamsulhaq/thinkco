/** `thinkco telegram` subcommand: configure the bot token and user allowlist from the CLI. */
import { createInterface } from 'node:readline';
import { logger } from '../util/logger.js';
import { saveGlobalConfig, type Config } from '../config/index.js';
import type { TelegramBotInfo } from '../frontends/telegram/transport.js';

/** Verify a bot token against Telegram's getMe endpoint. Throws on failure. */
export async function telegramGetMe(token: string, fetchImpl: typeof fetch = fetch): Promise<TelegramBotInfo> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as { ok: boolean; result?: TelegramBotInfo; description?: string };
  if (!json.ok || !json.result) throw new Error(json.description ?? `HTTP ${res.status}`);
  return json.result;
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

function parseIds(values: string[]): number[] {
  return values
    .flatMap((v) => v.split(/[\s,]+/))
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0);
}

const USAGE = `thinkco telegram <command>

  setup                     Interactive: enter bot token + allowed user IDs
  set-token <token>         Save the bot token to the global config
  add-user <id> [<id>...]   Allowlist one or more numeric Telegram user IDs
  remove-user <id> [...]    Remove user IDs from the allowlist
  status                    Show current token/allowlist state
  test                      Verify the bot token connects to Telegram (getMe)
  start                     Start the Telegram bot (same as --frontend telegram)`;

/**
 * Handle `thinkco telegram ...`. `globalDir` overrides where the global config is written
 * (used by tests); production passes undefined to use ~/.config/thinkco.
 */
export async function runTelegramCommand(
  positionals: string[],
  config: Config,
  globalDir?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const sub = positionals[1] ?? 'status';
  const rest = positionals.slice(2);

  switch (sub) {
    case 'set-token': {
      const token = rest[0];
      if (!token) {
        logger.error('Usage: thinkco telegram set-token <token>');
        return 1;
      }
      saveGlobalConfig({ telegram: { token } }, globalDir);
      logger.info('Saved Telegram bot token to global config (~/.config/thinkco/config.json).');
      logger.warn('The token is a secret stored in plain text — keep that file private.');
      return 0;
    }

    case 'add-user':
    case 'allow': {
      const ids = parseIds(rest);
      if (!ids.length) {
        logger.error('Usage: thinkco telegram add-user <id> [<id>...]  (numeric Telegram user IDs)');
        return 1;
      }
      const next = Array.from(new Set([...config.telegram.allowlist, ...ids]));
      saveGlobalConfig({ telegram: { allowlist: next } }, globalDir);
      logger.info(`Allowlist now: ${next.join(', ')}`);
      return 0;
    }

    case 'remove-user':
    case 'deny': {
      const drop = new Set(parseIds(rest));
      const next = config.telegram.allowlist.filter((id) => !drop.has(id));
      saveGlobalConfig({ telegram: { allowlist: next } }, globalDir);
      logger.info(`Allowlist now: ${next.join(', ') || '(empty)'}`);
      return 0;
    }

    case 'status': {
      const envToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
      const cfgToken = Boolean(config.telegram.token);
      const tokenState = envToken
        ? 'set (from TELEGRAM_BOT_TOKEN env)'
        : cfgToken
          ? 'set (from config)'
          : 'not set';
      logger.info(`Telegram token: ${tokenState}`);
      logger.info(
        `Allowlist (${config.telegram.allowlist.length}): ${config.telegram.allowlist.join(', ') || '(empty)'}`,
      );
      if (!cfgToken && !envToken) logger.info('Run `thinkco telegram setup` to configure.');
      return 0;
    }

    case 'setup': {
      logger.info('Configure Telegram. Get a token from @BotFather and your numeric id from @userinfobot.');
      const token = (await prompt('Bot token (blank = keep current): ')).trim();
      const idsRaw = (await prompt('Allowed user IDs (comma/space separated): ')).trim();
      const ids = idsRaw ? parseIds([idsRaw]) : [];
      const allowlist = Array.from(new Set([...config.telegram.allowlist, ...ids]));
      saveGlobalConfig({ telegram: { ...(token ? { token } : {}), allowlist } }, globalDir);
      const tokenSet = Boolean(token || config.telegram.token);
      logger.info(`Saved. Token: ${tokenSet ? 'set' : 'NOT set'}; allowlist: ${allowlist.join(', ') || '(empty)'}.`);
      logger.info('Start the bot with: thinkco telegram start');
      if (allowlist.length === 0) logger.warn('Allowlist is empty — the bot will refuse to start until you add a user.');
      return 0;
    }

    case 'test':
    case 'check': {
      const token = process.env.TELEGRAM_BOT_TOKEN ?? config.telegram.token;
      if (!token) {
        logger.error('No token to test. Set one with `thinkco telegram set-token <token>` or TELEGRAM_BOT_TOKEN.');
        return 1;
      }
      try {
        const me = await telegramGetMe(token, fetchImpl);
        logger.info(`✓ Connected as @${me.username ?? me.first_name ?? me.id} (bot id ${me.id}).`);
        const n = config.telegram.allowlist.length;
        logger.info(n ? `Allowlist: ${config.telegram.allowlist.join(', ')}` : 'Allowlist is empty — add a user before `start`.');
        logger.info('Send your bot a message after `thinkco telegram start` to use it.');
        return 0;
      } catch (err) {
        logger.error(`✗ Could not connect: ${(err as Error).message}`);
        logger.error('Check the token (from @BotFather) and your network.');
        return 1;
      }
    }

    default:
      logger.error(USAGE);
      return sub === 'help' || sub === '--help' ? 0 : 1;
  }
}
