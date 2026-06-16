/** First-run onboarding: pick a global default model and choose folder trust. */
import type { Config } from '../config/index.js';
import { saveGlobalConfig, saveProjectConfig } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { detectLocalProvider } from '../providers/local.js';
import { promptSelect } from '../ui/select.js';
import { box, c } from '../ui/ansi.js';

interface ModelOption {
  label: string;
  provider: string;
  model: string;
}

const CLOUD_MODELS: Record<string, string[]> = {
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
};

/** Build the list of selectable provider+model options based on what's available. */
async function buildOptions(config: Config): Promise<ModelOption[]> {
  const options: ModelOption[] = [];

  const local = await detectLocalProvider();
  if (local) {
    for (const model of local.models) {
      options.push({ label: `${local.provider} · ${model}  (local)`, provider: local.provider, model });
    }
  }

  for (const [provider, models] of Object.entries(CLOUD_MODELS)) {
    if (config.providers[provider]?.apiKey) {
      for (const model of models) options.push({ label: `${provider} · ${model}`, provider, model });
    }
  }

  options.push({ label: 'fake · offline demo (no key needed)', provider: 'fake', model: 'fake-1' });
  return options;
}

/**
 * Run the interactive onboarding. Returns true if it ran (TTY), false if skipped.
 * Mutates `config` with the chosen defaults and persists them globally.
 */
export async function runOnboarding(config: Config, _registry: ProviderRegistry): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  process.stdout.write(
    '\n' +
      box(
        [
          `${c.magenta('✻')} ${c.bold('Welcome to thinkco')}`,
          '',
          c.dim("Let's set a default model. You can change it any time with /models."),
        ],
        { color: c.magenta, padding: 2 },
      ) +
      '\n\n',
  );

  const options = await buildOptions(config);
  const labels = options.map((o) => o.label);
  const chosenLabel = await promptSelect('Choose your default model', labels, 0);
  const chosen = options.find((o) => o.label === chosenLabel) ?? options[options.length - 1]!;

  config.defaultProvider = chosen.provider;
  config.defaultModel = chosen.model;
  if (chosen.provider === 'ollama' || chosen.provider === 'lmstudio') {
    // Remember the local base URL discovered during detection isn't needed here;
    // the registry uses defaults. Just record provider+model globally.
  }
  saveGlobalConfig({ defaultProvider: chosen.provider, defaultModel: chosen.model });

  // Folder trust.
  const trustChoice = await promptSelect(
    `Trust this folder? ${c.dim('(' + process.cwd() + ')')}`,
    [
      'Trust — auto-approve basic read/write/edit/search in this folder',
      'Ask each time (safer)',
    ],
    1,
  );
  if (trustChoice && trustChoice.startsWith('Trust')) {
    const basics = ['read', 'list', 'glob', 'grep', 'write', 'edit', 'shell', 'git'];
    const allow = Array.from(new Set([...config.permissions.allow, ...basics]));
    config.permissions.allow = allow;
    saveProjectConfig({ permissions: { ...config.permissions, allow } });
    process.stdout.write(c.dim('Folder trusted. Destructive/secret actions will still ask.\n'));
  }

  process.stdout.write(
    `\n${c.green('✓')} Default set to ${c.cyan(chosen.provider + ' · ' + chosen.model)} ${c.dim('(saved globally)')}\n`,
  );
  return true;
}
