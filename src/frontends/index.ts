import { FrontendRegistry } from './types.js';

export * from './types.js';
export { CliFrontend, CliSink } from './cli.js';
export { TelegramFrontend } from './telegram/index.js';
export { redactSecrets } from './telegram/redact.js';
export type { TelegramTransport, TelegramUpdate } from './telegram/transport.js';

/** Build a registry of available frontends. Factories are wired by the entrypoint. */
export function createFrontendRegistry(): FrontendRegistry {
  return new FrontendRegistry();
}
