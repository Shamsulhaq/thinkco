import { describe, it, expect } from 'vitest';
import type { JsonRpcMessage, Transport } from '../src/mcp/transport.js';
import { McpClient } from '../src/mcp/client.js';
import { McpManager, namespacedName } from '../src/mcp/manager.js';
import { ToolRegistry } from '../src/tools/registry.js';

/** A mock MCP server transport: responds to initialize, tools/list, tools/call. */
class MockServerTransport implements Transport {
  private handler?: (m: JsonRpcMessage) => void;
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  async start(): Promise<void> {}

  send(message: JsonRpcMessage): void {
    // Respond asynchronously to mimic real transport.
    queueMicrotask(() => this.respond(message));
  }

  private respond(message: JsonRpcMessage): void {
    if (message.id === undefined) return; // notification
    if (message.method === 'initialize') {
      this.reply(message.id, { protocolVersion: '2024-11-05', capabilities: {} });
    } else if (message.method === 'tools/list') {
      this.reply(message.id, {
        tools: [
          {
            name: 'add',
            description: 'Add two numbers',
            inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
          },
        ],
      });
    } else if (message.method === 'tools/call') {
      const params = message.params as { name: string; arguments: Record<string, unknown> };
      this.calls.push({ name: params.name, args: params.arguments });
      const a = Number(params.arguments.a ?? 0);
      const b = Number(params.arguments.b ?? 0);
      this.reply(message.id, { content: [{ type: 'text', text: String(a + b) }], isError: false });
    }
  }

  private reply(id: number | string, result: unknown): void {
    this.handler?.({ jsonrpc: '2.0', id, result });
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {}
}

describe('MCP client + manager', () => {
  it('initializes, lists tools, and registers them namespaced', async () => {
    const transport = new MockServerTransport();
    const client = new McpClient({ transport });
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);

    const registered = await manager.connectClient('calc', client);
    expect(registered).toEqual([namespacedName('calc', 'add')]);
    expect(registry.has('mcp__calc__add')).toBe(true);

    const defs = registry.toToolDefs();
    const def = defs.find((d) => d.name === 'mcp__calc__add');
    expect(def?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('executes a registered MCP tool through the registry', async () => {
    const transport = new MockServerTransport();
    const client = new McpClient({ transport });
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    await manager.connectClient('calc', client);

    const res = await registry.execute(
      { id: '1', name: 'mcp__calc__add', input: { a: 2, b: 5 } },
      { cwd: '.' },
    );
    expect(res.isError).toBe(false);
    expect(res.output).toBe('7');
    expect(transport.calls[0]).toEqual({ name: 'add', args: { a: 2, b: 5 } });
  });

  it('describe lists connected servers and their tools', async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    await manager.connectClient('calc', new McpClient({ transport: new MockServerTransport() }));
    expect(manager.describe()).toEqual([{ server: 'calc', tools: ['mcp__calc__add'] }]);
    await manager.shutdown();
    expect(manager.describe()).toEqual([]);
  });

  it('connectAll reports per-server errors without throwing', async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    const report = await manager.connectAll({
      bad: { command: 'this-binary-does-not-exist-xyz', transport: 'stdio' },
    });
    expect(String(report.bad)).toMatch(/error:/);
  });

  it('connects over the HTTP transport (mock fetch)', async () => {
    const { HttpTransport } = await import('../src/mcp/transport.js');
    const mockFetch = (async (_url: string, init: { body: string }) => {
      const msg = JSON.parse(init.body) as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      const reply = (result: unknown) => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }),
      });
      if (msg.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: {} }) as unknown as Response;
      if (msg.method === 'tools/list') {
        return reply({ tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object' } }] }) as unknown as Response;
      }
      if (msg.method === 'tools/call') {
        return reply({ content: [{ type: 'text', text: 'pong' }], isError: false }) as unknown as Response;
      }
      return reply({}) as unknown as Response;
    }) as unknown as typeof fetch;

    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    const client = new McpClient({ transport: new HttpTransport({ url: 'http://localhost:9999/mcp', fetchImpl: mockFetch }) });
    const registered = await manager.connectClient('remote', client);
    expect(registered).toEqual([namespacedName('remote', 'ping')]);
    const res = await registry.execute({ id: '1', name: 'mcp__remote__ping', input: {} }, { cwd: '.' });
    expect(res.output).toBe('pong');
  });
});
