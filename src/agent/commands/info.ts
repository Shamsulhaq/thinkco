/** Info & session commands: /usage, /mode, /trust. */
import type { SlashCommand } from '../commands.js';
import type { PermissionMode } from '../../permissions/index.js';
import { saveProjectConfig } from '../../config/index.js';
import type { CommandHost } from './host.js';

export function buildInfoCommands(host: CommandHost): SlashCommand[] {
  return [
    {
      name: 'usage',
      description: 'Show token usage and estimated cost (live pricing from models.dev)',
      run: async () => {
        try {
          const { loadPricing } = await import('../../util/pricing.js');
          host.usage.setPricing(await loadPricing());
        } catch {
          /* offline → token counts only */
        }
        return { handled: true, message: host.usage.format(host.state.model, host.state.provider) };
      },
    },
    {
      name: 'mode',
      description: 'Permission mode: /mode [default|acceptEdits|plan|dontAsk|auto|bypass]',
      run: (ctx) => {
        const valid = ['default', 'acceptEdits', 'plan', 'dontAsk', 'auto', 'bypass'];
        if (ctx.args && valid.includes(ctx.args)) {
          host.setMode(ctx.args as PermissionMode);
          return { handled: true, message: `Permission mode: ${ctx.args}` };
        }
        return {
          handled: true,
          message:
            `Permission mode: ${host.getMode()}\n` +
            `Cycle with Shift+Tab, or /mode <name>. Modes: default, acceptEdits, plan, dontAsk, auto, bypass.`,
        };
      },
    },
    {
      name: 'trust',
      description: 'Trust this folder: auto-approve basic read/write/edit/search/shell actions',
      run: () => {
        const basics = ['read', 'list', 'glob', 'grep', 'write', 'edit', 'shell', 'git'];
        const allow = host.config.permissions.allow;
        for (const t of basics) if (!allow.includes(t)) allow.push(t);
        saveProjectConfig({ permissions: host.config.permissions });
        return {
          handled: true,
          message: 'Folder trusted: basic actions auto-approved. Destructive/secret actions still ask.',
        };
      },
    },
  ];
}
