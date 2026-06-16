/** Discover MCP servers declared by Claude Code-format plugins so thinkco can auto-start them. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { McpManager } from '../mcp/manager.js';
import { bundledPluginsRoot } from './paths.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Config } from '../config/index.js';
import type { McpServerConfig } from '../mcp/manager.js';

export { bundledPluginsRoot } from './paths.js';

interface ClaudeMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'stdio' | 'http';
  /** Claude Code marks non-core servers optional; we only auto-start required ones. */
  optional?: boolean;
}

/** Read `<plugin>/.claude-plugin/plugin.json` and return its required MCP servers. */
export function mcpServersFromClaudePlugin(pluginDir: string): Record<string, McpServerConfig> {
  const manifest = join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifest)) return {};
  let raw: { mcpServers?: Record<string, ClaudeMcpEntry> };
  try {
    raw = JSON.parse(readFileSync(manifest, 'utf8')) as { mcpServers?: Record<string, ClaudeMcpEntry> };
  } catch {
    return {};
  }
  const servers = raw.mcpServers;
  if (!servers || typeof servers !== 'object') return {};
  const out: Record<string, McpServerConfig> = {};
  for (const [name, e] of Object.entries(servers)) {
    if (!e || e.optional === true) continue; // only auto-start required servers
    if (e.command) out[name] = { command: e.command, args: e.args, env: e.env };
    else if (e.url) out[name] = { transport: 'http', url: e.url, headers: undefined };
  }
  return out;
}

/** The directory of plugins bundled with thinkco. */

/**
 * Collect MCP servers contributed by Claude Code plugins: bundled defaults under `plugins/`
 * plus any opt-in plugin directories in `config.claudePlugins`. thinkco starts these as managed
 * child processes and stops them on exit — no manual `npx … mcp start` required.
 */
export function collectClaudeMcpServers(cwd: string, claudePlugins: string[] = []): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const root = bundledPluginsRoot();
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      try {
        if (statSync(dir).isDirectory() && existsSync(join(dir, '.claude'))) {
          Object.assign(out, mcpServersFromClaudePlugin(dir));
        }
      } catch {
        // skip unreadable bundle
      }
    }
  }
  for (const p of claudePlugins) {
    const dir = isAbsolute(p) ? p : join(cwd, p);
    try {
      if (existsSync(dir)) Object.assign(out, mcpServersFromClaudePlugin(dir));
    } catch {
      // skip bad path
    }
  }
  return out;
}

/**
 * Start every MCP server from config (`mcpServers`) and from Claude Code plugins, registering their
 * tools into `tools`. Returns the manager (call `.shutdown()` on exit) or undefined if none.
 * Errors per server are non-fatal — a missing server just means its tools are unavailable.
 */
export async function startConfiguredMcp(
  tools: ToolRegistry,
  config: Config,
  cwd: string,
  log?: (msg: string) => void,
): Promise<McpManager | undefined> {
  const servers = { ...config.mcpServers, ...collectClaudeMcpServers(cwd, config.claudePlugins) };
  const names = Object.keys(servers);
  if (names.length === 0) return undefined;
  const manager = new McpManager(tools);
  log?.(`Starting ${names.length} MCP server(s): ${names.join(', ')} (managed by thinkco)…`);
  const report = await manager.connectAll(servers);
  if (log) {
    for (const [name, result] of Object.entries(report)) {
      log(`  ${name}: ${Array.isArray(result) ? `${result.length} tool(s)` : result}`);
    }
  }
  return manager;
}
