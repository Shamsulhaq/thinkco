/** A small curated plugin registry: resolve install-by-name and search. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bundledPluginsRoot } from './paths.js';

export interface RegistryEntry {
  name: string;
  description: string;
  url: string;
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
  },
  {
    name: 'conventional-commits',
    description: 'Skill for writing Conventional Commits messages.',
    url: 'https://github.com/thinkco/plugin-conventional-commits',
  },
];

/** Search the registry by name/description substring. */
export function searchRegistry(query: string, registry: RegistryEntry[] = KNOWN_PLUGINS): RegistryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return registry;
  return registry.filter(
    (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
  );
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
  if (/^(https?:\/\/|git@|\.{0,2}\/)/.test(nameOrSource)) return nameOrSource;
  const entry = registry.find((e) => e.name === nameOrSource);
  if (!entry) {
    throw new Error(`Unknown plugin "${nameOrSource}". Try /plugin search, or pass a git URL/path.`);
  }
  const bundled = bundledPluginDir(entry.name);
  if (existsSync(join(bundled, 'plugin.json'))) return bundled;
  return entry.url;
}
