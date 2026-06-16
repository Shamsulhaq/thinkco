/** Locate the `plugins/` directory bundled with thinkco, robust to dev/dist/global/bundle layouts. */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Search upward from this module for a `plugins/` directory containing the bundled `ruflo-core`
 * plugin. Works whether running from `src` (tsx), `dist/plugins/*.js`, a global install, or a
 * single bundled file at `dist/thinkco.mjs`.
 */
export function bundledPluginsRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'plugins');
    if (existsSync(join(candidate, 'ruflo-core'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume ../../plugins relative to this module.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins');
}
