/** Cost, snapshot & reliability commands: /budget, /undo, /fallback. */
import type { SlashCommand } from '../commands.js';
import { saveGlobalConfig } from '../../config/index.js';
import type { CommandHost } from './host.js';

export function buildBudgetCommands(host: CommandHost): SlashCommand[] {
  return [
    {
      name: 'budget',
      description: 'Set or show the per-session cost cap: /budget <usd> | off',
      run: (ctx) => {
        const arg = ctx.args.trim();
        if (arg) host.config.maxCostUSD = arg === 'off' ? 0 : Math.max(0, Number(arg) || 0);
        const spent = host.usage.estimateCost(host.state.model, host.state.provider);
        const cap = host.config.maxCostUSD;
        return {
          handled: true,
          message: cap ? `Budget ${cap} · spent ~${spent.toFixed(4)}` : `No budget cap · spent ~${spent.toFixed(4)}`,
        };
      },
    },
    {
      name: 'undo',
      description: 'Restore the working tree to the snapshot from before the last turn (needs autoCommit)',
      run: () => {
        if (!host.config.autoCommit) return { handled: true, message: 'Enable "autoCommit" in config to use /undo.' };
        const sha = host.gitSnap().undo();
        return { handled: true, message: sha ? `Reverted working tree to snapshot ${sha.slice(0, 8)}.` : 'No snapshot to undo.' };
      },
    },
    {
      name: 'fallback',
      description: 'Show/set the failover chain: /fallback | /fallback openai:gpt-4o, anthropic | /fallback off',
      run: (ctx) => {
        const arg = ctx.args.trim();
        if (!arg) {
          const chain = host.config.fallback;
          const shown = chain.length
            ? chain.map((f) => `${f.provider}${f.model ? ':' + f.model : ''}`).join(' → ')
            : '(none — configure with: /fallback <provider[:model]>, …)';
          return { handled: true, message: `Active: ${host.state.provider}:${host.state.model}\nFallback chain: ${shown}` };
        }
        if (arg === 'off' || arg === 'clear') {
          host.config.fallback = [];
          saveGlobalConfig({ fallback: [] }, host.globalConfigDir);
          return { handled: true, message: 'Fallback chain cleared.' };
        }
        const entries = arg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const i = s.indexOf(':');
            return i > 0 ? { provider: s.slice(0, i), model: s.slice(i + 1) } : { provider: s };
          });
        host.config.fallback = entries;
        saveGlobalConfig({ fallback: entries }, host.globalConfigDir);
        const shown = entries.map((e) => `${e.provider}${e.model ? ':' + e.model : ''}`).join(' → ');
        return {
          handled: true,
          message: `Fallback chain set: ${shown}\nOn a provider error mid-turn, thinkco will switch to the next entry and retry.`,
        };
      },
    },
  ];
}
