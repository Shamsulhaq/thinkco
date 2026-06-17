/** Provider & model commands: /provider, /login, /models. */
import type { SlashCommand } from '../commands.js';
import { saveGlobalConfig } from '../../config/index.js';
import type { CommandHost } from './host.js';

export function buildProviderCommands(host: CommandHost): SlashCommand[] {
  return [providerCommand(host), loginCommand(host), modelsCommand(host)];
}

function providerCommand(host: CommandHost): SlashCommand {
  return {
    name: 'provider',
    description: 'List configured providers and switch between them',
    run: async (ctx) => {
      if (ctx.args.trim() === 'status') {
        return { handled: true, message: host.providerStatus() };
      }
      // Direct switch: `/provider openai`
      if (ctx.args) {
        const id = ctx.args.trim();
        if (!host.providerRegistry.has(id) && !host.config.providers[id]) {
          return { handled: true, message: `Unknown provider "${id}". Known: ${host.knownProviders().join(', ')}.` };
        }
        if (!host.isProviderConfigured(id)) {
          return { handled: true, message: `Provider "${id}" has no API key configured. Run /login to add one.` };
        }
        return { handled: true, message: await host.switchProvider(id) };
      }

      const providers = host.configuredProviders();
      const labels = providers.map((id) => `${id}${id === host.state.provider ? '  (current)' : ''}`);
      const current = Math.max(0, providers.indexOf(host.state.provider));
      const choice = await host.ui.select('Configured providers (run /login to add more)', labels, current);
      if (!choice) {
        return { handled: true, message: `Configured providers:\n${labels.join('\n')}\n\nRun /login to add a provider.` };
      }
      const id = providers[labels.indexOf(choice)];
      if (!id || id === host.state.provider) {
        return { handled: true, message: `Staying on ${host.state.provider}.` };
      }
      return { handled: true, message: await host.switchProvider(id) };
    },
  };
}

function loginCommand(host: CommandHost): SlashCommand {
  return {
    name: 'login',
    description: 'Add a provider API key, or a custom OpenAI-compatible provider',
    run: async () => {
      const ui = host.ui;
      if (!ui.input) {
        return { handled: true, message: '/login is only available in an interactive terminal.' };
      }
      const { PROVIDER_PRESETS, CUSTOM_PRESET_LABEL } = await import('../../providers/presets.js');
      const labels = [...PROVIDER_PRESETS.map((p) => p.label), CUSTOM_PRESET_LABEL];
      const choice = await ui.select('Choose a provider', labels, 0);
      if (!choice) return { handled: true, message: 'Cancelled.' };

      const cfg = host.config;

      // Custom OpenAI-compatible provider.
      if (choice === CUSTOM_PRESET_LABEL) {
        const name = (await ui.input('Provider id (e.g. fireworks, deepinfra):'))?.trim();
        if (!name) return { handled: true, message: 'Cancelled.' };
        const baseUrl = (await ui.input('Base URL (OpenAI-compatible, e.g. https://api.x.ai/v1):'))?.trim();
        if (!baseUrl) return { handled: true, message: 'Cancelled.' };
        const apiKey = (await ui.input(`API key for ${name}:`, { password: true }))?.trim();
        cfg.providers[name] = { ...cfg.providers[name], baseUrl, ...(apiKey ? { apiKey } : {}) };
        host.providerRegistry.registerConfiguredProviders(cfg);
        saveGlobalConfig({ providers: { [name]: { baseUrl, ...(apiKey ? { apiKey } : {}) } } }, host.globalConfigDir);
        host.state.provider = name;
        return { handled: true, message: await host.finishLogin() };
      }

      const preset = PROVIDER_PRESETS.find((p) => p.label === choice)!;
      let apiKey: string | undefined;
      if (preset.needsKey) {
        apiKey = (await ui.input(`API key for ${preset.label}:`, { password: true }))?.trim() || undefined;
        if (!apiKey) return { handled: true, message: 'Cancelled (no key entered).' };
      }
      // Non-native presets (OpenRouter/Groq/Together/opencode) are OpenAI-compatible: store baseUrl.
      const entry: Record<string, string> = {};
      if (!preset.native && preset.baseUrl) entry.baseUrl = preset.baseUrl;
      if (preset.id === 'ollama' || preset.id === 'lmstudio') {
        if (preset.baseUrl) entry.baseUrl = preset.baseUrl;
      }
      if (apiKey) entry.apiKey = apiKey;
      cfg.providers[preset.id] = { ...cfg.providers[preset.id], ...entry };
      if (!preset.native) host.providerRegistry.registerConfiguredProviders(cfg);
      saveGlobalConfig({ providers: { [preset.id]: entry } }, host.globalConfigDir);
      host.state.provider = preset.id;
      return { handled: true, message: await host.finishLogin() };
    },
  };
}

function modelsCommand(host: CommandHost): SlashCommand {
  return {
    name: 'models',
    description: 'Pick a model with ↑/↓ arrows; /models refresh fetches live models again',
    run: async (ctx) => {
      const before = host.state.model;
      const refresh = ctx.args.trim() === 'refresh';
      const result = await host.selectModelForProvider(host.state.provider, {
        prompt: true,
        saveScope: true,
        title: refresh ? `Refresh models for ${host.state.provider}` : undefined,
      });
      if (result.cancelled || result.model === before) return { handled: true, message: `Model unchanged (${host.state.model}).` };
      const source = result.usedFallback ? 'registry fallback' : `${result.liveCount} live model(s)`;
      return { handled: true, message: `Model set to ${result.model}. Source: ${source}.` };
    },
  };
}
