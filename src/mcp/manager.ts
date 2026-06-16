/** Map MCP tools into thinkco tools and manage server lifecycle. */
import { z } from 'zod';
import type { Tool } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { McpClient, type McpTool } from './client.js';
import { StdioTransport, HttpTransport } from './transport.js';

/** Namespaced tool name: mcp__<server>__<tool>. */
export function namespacedName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** Wrap an MCP tool as a thinkco Tool. */
export function mcpToolToTool(client: McpClient, server: string, mcpTool: McpTool): Tool<Record<string, unknown>> {
  return {
    name: namespacedName(server, mcpTool.name),
    description: mcpTool.description ?? `MCP tool ${mcpTool.name} from ${server}`,
    risk: 'execute',
    schema: z.record(z.unknown()),
    rawInputSchema: mcpTool.inputSchema ?? { type: 'object', properties: {} },
    run: async (input) => {
      const res = await client.callTool(mcpTool.name, input);
      if (res.isError) throw new Error(res.text || 'MCP tool returned an error');
      return res.text;
    },
  };
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  transport?: 'stdio' | 'http';
  url?: string;
  headers?: Record<string, string>;
}

interface ManagedServer {
  name: string;
  client: McpClient;
  tools: string[];
}

/** Manages connected MCP servers and their registered tools. */
export class McpManager {
  private readonly servers: ManagedServer[] = [];

  constructor(private readonly registry: ToolRegistry) {}

  /** Connect a server via an existing client (used for tests with a mock transport). */
  async connectClient(name: string, client: McpClient): Promise<string[]> {
    await client.initialize();
    const mcpTools = await client.listTools();
    const registered: string[] = [];
    for (const t of mcpTools) {
      const tool = mcpToolToTool(client, name, t);
      this.registry.register(tool);
      registered.push(tool.name);
    }
    this.servers.push({ name, client, tools: registered });
    return registered;
  }

  /** Connect a server defined by config (stdio or http). */
  async connect(name: string, config: McpServerConfig): Promise<string[]> {
    let transport;
    if (config.transport === 'http') {
      if (!config.url) throw new Error(`HTTP MCP server "${name}" requires a url`);
      transport = new HttpTransport({ url: config.url, headers: config.headers });
    } else {
      if (!config.command) throw new Error(`stdio MCP server "${name}" requires a command`);
      transport = new StdioTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
    }
    const client = new McpClient({ transport });
    return this.connectClient(name, client);
  }

  /** Connect all servers in a config map. Errors per-server are collected, not thrown. */
  async connectAll(servers: Record<string, McpServerConfig>): Promise<Record<string, string | string[]>> {
    const report: Record<string, string | string[]> = {};
    for (const [name, cfg] of Object.entries(servers)) {
      try {
        report[name] = await this.connect(name, cfg);
      } catch (err) {
        report[name] = `error: ${(err as Error).message}`;
      }
    }
    return report;
  }

  describe(): Array<{ server: string; tools: string[] }> {
    return this.servers.map((s) => ({ server: s.name, tools: s.tools }));
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.client.close().catch(() => {})));
    this.servers.length = 0;
  }
}
