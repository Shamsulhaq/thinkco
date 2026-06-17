/** A small curated plugin registry: resolve install-by-name and search. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bundledPluginsRoot } from './paths.js';

export interface RegistryEntry {
  name: string;
  description: string;
  url: string;
  category?: string;
  tags?: string[];
  bundled?: boolean;
  installSource?: string;
  installable?: boolean;
}

/**
 * Curated registry (name → git URL). This is intentionally a small built-in list;
 * a hosted marketplace can replace `KNOWN_PLUGINS` later without changing callers.
 */
export const KNOWN_PLUGINS: RegistryEntry[] = [
  {
    name: 'code-review',
    description: 'Adds a /review command and a code-review skill.',
    url: 'https://github.com/thinkco/plugin-code-review',
    category: 'review',
    tags: ['review', 'quality', 'skills'],
    bundled: true,
    installSource: 'bundled',
  },
  {
    name: 'conventional-commits',
    description: 'Skill for writing Conventional Commits messages.',
    url: 'https://github.com/thinkco/plugin-conventional-commits',
    category: 'git',
    tags: ['commits', 'git', 'release'],
    bundled: true,
    installSource: 'bundled',
  },
  {
    name: 'ruflo-core',
    description: 'Core Ruflo workflows and agent helpers.',
    url: 'https://github.com/thinkco/plugin-ruflo-core',
    category: 'agents',
    tags: ['ruflo', 'workflow', 'agents'],
    bundled: true,
    installSource: 'bundled',
    installable: false,
  },
  {
    name: 'test-runner',
    description: 'Commands and skills for running focused project tests.',
    url: 'https://github.com/thinkco/plugin-test-runner',
    category: 'testing',
    tags: ['tests', 'vitest', 'pytest'],
    installable: false,
  },
  {
    name: 'k8s-ops',
    description: 'Kubernetes inspection and operations helpers.',
    url: 'https://github.com/thinkco/plugin-k8s-ops',
    category: 'infra',
    tags: ['k8s', 'kubernetes', 'cluster'],
    installable: false,
  },
  {
    name: 'terraform-iac',
    description: 'Terraform and infrastructure-as-code review helpers.',
    url: 'https://github.com/thinkco/plugin-terraform-iac',
    category: 'infra',
    tags: ['terraform', 'iac', 'cloud'],
    installable: false,
  },
  {
    name: 'python-pro',
    description: 'Python refactoring, packaging, and test helpers.',
    url: 'https://github.com/thinkco/plugin-python-pro',
    category: 'languages',
    tags: ['python', 'pytest', 'typing'],
    installable: false,
  },
  {
    name: 'typescript-pro',
    description: 'TypeScript quality, typecheck, and build helpers.',
    url: 'https://github.com/thinkco/plugin-typescript-pro',
    category: 'languages',
    tags: ['typescript', 'tsc', 'eslint'],
    installable: false,
  },
  {
    name: 'docs-writer',
    description: 'Documentation drafting and API docs helpers.',
    url: 'https://github.com/thinkco/plugin-docs-writer',
    category: 'docs',
    tags: ['docs', 'readme', 'api'],
    installable: false,
  },
  {
    name: 'security-audit',
    description: 'Security review and dependency audit helpers.',
    url: 'https://github.com/thinkco/plugin-security-audit',
    category: 'security',
    tags: ['security', 'audit', 'dependencies'],
    installable: false,
  },
  {
    name: 'release-notes',
    description: 'Release note and changelog generation helpers.',
    url: 'https://github.com/thinkco/plugin-release-notes',
    category: 'git',
    tags: ['release', 'changelog', 'commits'],
    installable: false,
  },
];

/** Search the registry by name/description substring. */
export function searchRegistry(query: string, registry: RegistryEntry[] = KNOWN_PLUGINS): RegistryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return registry;
  return registry.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      (e.category ?? '').toLowerCase().includes(q) ||
      (e.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
  );
}

export function categories(registry: RegistryEntry[] = KNOWN_PLUGINS): string[] {
  return Array.from(new Set(registry.map((e) => e.category).filter((c): c is string => Boolean(c)))).sort();
}

export function listByCategory(category: string, registry: RegistryEntry[] = KNOWN_PLUGINS): RegistryEntry[] {
  const q = category.trim().toLowerCase();
  return registry.filter((e) => (e.category ?? '').toLowerCase() === q);
}

export function isRegistryEntryInstallable(entry: RegistryEntry): boolean {
  if (entry.installable === false) return false;
  if (!entry.bundled) return true;
  return existsSync(join(bundledPluginDir(entry.name), 'plugin.json'));
}

/** Directory of a plugin bundled with thinkco, if present (../../plugins/<name>). */
export function bundledPluginDir(name: string): string {
  return join(bundledPluginsRoot(), name);
}

/**
 * Resolve an install source. If it's already a git URL or local path, return as-is.
 * Otherwise treat it as a registry name: prefer a bundled local copy (offline, no git),
 * falling back to the registry's git URL.
 */
export function resolveInstallSource(
  nameOrSource: string,
  registry: RegistryEntry[] = KNOWN_PLUGINS,
): string {
  if (/^(https?:\/\/|git@|\.{0,2}\/|\/)/.test(nameOrSource)) return nameOrSource;
  const entry = registry.find((e) => e.name === nameOrSource);
  if (!entry) {
    throw new Error(`Unknown plugin "${nameOrSource}". Try /plugin search, or pass a git URL/path.`);
  }
  if (entry.installable === false) {
    throw new Error(`Plugin "${entry.name}" is listed for discovery but is not packaged for one-click install. Pass a git URL or local path instead.`);
  }
  const bundled = bundledPluginDir(entry.name);
  if (existsSync(join(bundled, 'plugin.json'))) return bundled;
  return entry.url;
}
