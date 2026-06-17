/** Theme command: /theme [name] — list or switch the TUI color theme. */
import type { SlashCommand } from '../commands.js';
import { saveGlobalConfig } from '../../config/index.js';
import { setTheme, getTheme, themeNames } from '../../ui/theme.js';
import type { CommandHost } from './host.js';

export function buildThemeCommand(host: CommandHost): SlashCommand {
  return {
    name: 'theme',
    description: `Switch the TUI color theme: /theme [${themeNames().join('|')}]`,
    run: (ctx) => {
      const name = ctx.args.trim();
      if (!name) {
        return {
          handled: true,
          message: `Current theme: ${getTheme().name}\nAvailable: ${themeNames().join(', ')}\nUse /theme <name> (auto-detected from the terminal if unset).`,
        };
      }
      if (!setTheme(name)) {
        return { handled: true, message: `Unknown theme "${name}". Available: ${themeNames().join(', ')}.` };
      }
      host.config.theme = name;
      saveGlobalConfig({ theme: name }, host.globalConfigDir);
      return { handled: true, message: `Theme set to ${name}.` };
    },
  };
}
