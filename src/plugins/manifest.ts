/** Plugin manifest: declares the components a plugin contributes. */
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
  /** Command markdown files (relative to plugin dir). */
  commands: z.array(z.string()).default([]),
  /** Skill directories (relative to plugin dir), each containing SKILL.md. */
  skills: z.array(z.string()).default([]),
  /** MCP servers contributed by the plugin. */
  mcpServers: z
    .record(
      z.string(),
      z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        transport: z.enum(['stdio', 'http']).optional(),
      }),
    )
    .default({}),
  /** Lifecycle hooks contributed by the plugin. */
  hooks: z.record(z.string(), z.array(z.string())).default({}),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface LoadedManifest {
  manifest: PluginManifest;
  dir: string;
}

/** Read and validate plugin.json from a plugin directory. */
export function parseManifest(dir: string): LoadedManifest {
  const file = join(dir, 'plugin.json');
  if (!existsSync(file)) throw new Error(`No plugin.json in ${dir}`);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid plugin manifest in ${dir}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return { manifest: parsed.data, dir };
}
