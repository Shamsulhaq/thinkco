#!/usr/bin/env node
/** thinkco CLI entrypoint. */
import { VERSION } from '../index.js';
import { loadConfig } from '../config/index.js';
import { logger } from '../util/logger.js';
import { ThinkcoError } from '../util/errors.js';
import { parseArgs } from './args.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const HELP = `thinkco v${VERSION} — multi-provider agentic coding CLI

USAGE
  thinkco [options]                 Start an interactive session (REPL)
  thinkco -p "<task>" [options]     Run a single task headless (non-interactive)
  thinkco telegram <cmd>            Configure/start the Telegram bot (config|setup|set-token|add-user|status|start)
  thinkco schedule                  Run configured scheduled tasks in the foreground

OPTIONS
  -p, --print <task>     Headless mode: run one task and exit
  --provider <name>      Provider to use (anthropic | openai | ollama | ...)
  --model <name>         Model id to use
  --permission-mode <m>  default | acceptEdits | plan | dontAsk | auto | bypass
  --classic              Use the classic readline REPL instead of the TUI
  --resume [id]          Resume the latest session, or a specific one by id
  --yes                  Headless: auto-approve actions
  --json                 Emit machine-readable JSON output (headless)
  --log-level <level>    debug | info | warn | error | silent
  -v, --version          Print version and exit
  -h, --help             Show this help and exit

CONFIG
  Global   ~/.config/thinkco/config.json
  Project  ./.thinkco/config.json   (overrides global)
  Env      ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY

Docs: see AGENT.md and WORKPLAN.md`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ['version', 'help', 'json', 'v', 'h', 'classic', 'resume', 'yes', 'y']);

  if (args.flags.has('version') || args.flags.has('v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args.flags.has('help') || args.flags.has('h')) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const overrides: Record<string, unknown> = {};
  if (args.options.has('provider')) overrides.defaultProvider = args.options.get('provider');
  if (args.options.has('model')) overrides.defaultModel = args.options.get('model');
  if (args.options.has('log-level')) overrides.logLevel = args.options.get('log-level');
  if (args.options.has('permission-mode')) {
    overrides.permissions = { defaultMode: args.options.get('permission-mode') };
  }

  const config = loadConfig({ overrides });
  logger.setLevel(config.logLevel);

  // `thinkco schedule` — run configured scheduled tasks in the foreground.
  if (args.positionals[0] === 'schedule') {
    if (config.schedule.length === 0) {
      logger.error('No scheduled tasks configured. Add a "schedule" array to .thinkco/config.json.');
      return 1;
    }
    const { runScheduler } = await import('../workflows/schedule.js');
    const { runHeadless } = await import('../workflows/headless.js');
    const autoApprove = args.flags.has('yes') || args.flags.has('y') ? 'allow' : 'deny';
    logger.info(`Scheduler started with ${config.schedule.length} task(s). Ctrl-C to stop.`);
    const ac = new AbortController();
    process.on('SIGINT', () => ac.abort());
    await runScheduler(
      config.schedule,
      async (prompt) => {
        logger.info(`[schedule] running: ${prompt.slice(0, 60)}`);
        const result = await runHeadless(prompt, { config, autoApprove });
        process.stdout.write(`[schedule] ${result.status}: ${result.text.slice(0, 200)}\n`);
      },
      { signal: ac.signal, pollMs: 5000 },
    );
    return 0;
  }

  const task =
    args.options.get('print') ??
    args.options.get('p') ??
    (args.flags.has('p') ? args.positionals[0] : undefined);
  if (task !== undefined) {
    const { runHeadless, formatHeadless } = await import('../workflows/headless.js');
    const result = await runHeadless(task, {
      config,
      json: args.flags.has('json'),
      autoApprove: args.flags.has('yes') || args.flags.has('y') ? 'allow' : 'deny',
    });
    process.stdout.write(`${formatHeadless(result, args.flags.has('json'))}\n`);
    return result.status === 'ok' ? 0 : 1;
  }

  // Interactive REPL (Phase 2).
  const { ProviderRegistry } = await import('../providers/registry.js');
  const { ToolRegistry } = await import('../tools/registry.js');
  const { registerCoreTools } = await import('../tools/core/index.js');
  const { SessionStore } = await import('../agent/session.js');
  const { CliFrontend } = await import('../frontends/cli.js');
  const { join } = await import('node:path');

  const providerRegistry = new ProviderRegistry();
  providerRegistry.registerConfiguredProviders(config);
  const { ensureKnownProvider, resolveProvider } = await import('./resolve.js');
  if (ensureKnownProvider(config, providerRegistry)) {
    logger.warn(`Provider not found; falling back to "fake".`);
  }

  // First-run onboarding (interactive only): pick a global default model + trust folder.
  const { isFirstRun } = await import('../config/index.js');
  const wantsTelegram = args.options.get('frontend') === 'telegram' || args.positionals[0] === 'telegram';
  if (isFirstRun() && process.stdin.isTTY && !wantsTelegram) {
    const { runOnboarding } = await import('./onboarding.js');
    await runOnboarding(config, providerRegistry);
  }

  // `thinkco telegram <cmd>` — configure the bot (token/allowlist). `start` falls through to launch.
  if (args.positionals[0] === 'telegram' && args.positionals[1] !== 'start') {
    const { runTelegramCommand } = await import('./telegram.js');
    return runTelegramCommand(args.positionals, config);
  }

  // Remote frontend (Telegram).
  if (wantsTelegram) {
    const token = process.env.TELEGRAM_BOT_TOKEN ?? config.telegram.token;
    if (!token) {
      logger.error('No Telegram bot token. Set one with `thinkco telegram set-token <token>` or TELEGRAM_BOT_TOKEN.');
      return 1;
    }
    if (config.telegram.allowlist.length === 0) {
      logger.error('Refusing to start Telegram bot with an empty allowlist (remote = remote code execution).');
      return 1;
    }
    const { HttpTelegramTransport } = await import('../frontends/telegram/transport.js');
    const { TelegramFrontend } = await import('../frontends/telegram/index.js');
    const transport = new HttpTelegramTransport(token);
    const tg = new TelegramFrontend({ transport, config, allowlist: config.telegram.allowlist, providerRegistry });
    logger.info(`Starting Telegram frontend (allowlist: ${config.telegram.allowlist.length} user(s)).`);
    await tg.start();
    // Long-polling runs in the background; keep the process alive until interrupted.
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        logger.info('Stopping Telegram bot…');
        void tg.stop();
        resolve();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
    return 0;
  }

  const tools = new ToolRegistry();
  registerCoreTools(tools);
  const sessionStore = new SessionStore(join(process.cwd(), '.thinkco', 'sessions'));

  // Auto-start MCP servers (from config + Claude Code plugins) as managed child processes.
  const { startConfiguredMcp } = await import('../plugins/claudeMcp.js');
  const mcp = await startConfiguredMcp(tools, config, process.cwd(), (m) => logger.info(m));
  if (mcp) {
    const stopMcp = () => void mcp.shutdown();
    process.once('exit', stopMcp);
    process.once('SIGINT', stopMcp);
    process.once('SIGTERM', stopMcp);
  }

  // Ensure the chosen provider is usable; otherwise detect a local LLM, else offline 'fake'.
  const { detectLocalProvider, listModels } = await import('../providers/local.js');
  const resolution = await resolveProvider(config, providerRegistry, {
    detectLocal: detectLocalProvider,
    listModels,
  });
  const availableModels = resolution.availableModels;
  if (resolution.status === 'local' && resolution.local) {
    process.stdout.write(
      `\x1b[32mDetected local LLM\x1b[0m: ${resolution.local.provider} at ${resolution.local.baseUrl}.\n` +
        `Using model "${config.defaultModel}". ${resolution.local.models.length} model(s) available — type \x1b[1m/models\x1b[0m to pick (↑/↓).\n\n`,
    );
  } else if (resolution.status === 'offline') {
    process.stdout.write(
      `\x1b[33mthinkco is running in offline mode\x1b[0m (no API key for "${resolution.requested}", no local LLM detected).\n\n` +
        `Options:\n` +
        `  • Start Ollama (ollama serve) or LM Studio, then relaunch thinkco — models are auto-detected.\n` +
        `  • Or set a cloud key:  export ANTHROPIC_API_KEY=...  (or OPENAI_API_KEY / GEMINI_API_KEY)\n\n` +
        `Continuing with the offline 'fake' provider so you can explore.\n\n`,
    );
  }

  const useInk = process.stdin.isTTY && process.stdout.isTTY && !args.flags.has('classic');
  const frontendOpts = {
    config,
    providerRegistry,
    tools,
    sessionStore,
    resume: args.flags.has('resume'),
    resumeId: args.flags.has('resume') ? args.positionals[0] : undefined,
    auditPath: join(process.cwd(), '.thinkco', 'audit.log'),
    availableModels,
  };

  if (useInk) {
    try {
      const { InkFrontend } = await import('../frontends/ink/index.js');
      await new InkFrontend(frontendOpts).start();
      return 0;
    } catch (err) {
      logger.warn(`TUI failed to start (${(err as Error).message}); falling back to classic REPL.`);
    }
  }

  const frontend = new CliFrontend(frontendOpts);
  await frontend.start();
  return 0;
}

const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    // Resolve symlinks (e.g. the npm-link bin) before comparing to this module's path.
    return realpathSync(arg) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      if (err instanceof ThinkcoError) {
        logger.error(`${err.code}: ${err.message}`);
      } else {
        logger.error('Unexpected error:', err);
      }
      process.exit(1);
    });
}
