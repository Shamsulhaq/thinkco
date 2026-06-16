/** Minimal MCP client: initialize handshake, tools/list, tools/call over a Transport. */
import type { JsonRpcMessage, Transport } from './transport.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpClientOptions {
  transport: Transport;
  clientName?: string;
  clientVersion?: string;
  requestTimeoutMs?: number;
}

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly transport: Transport;
  private readonly timeoutMs: number;

  constructor(private readonly opts: McpClientOptions) {
    this.transport = opts.transport;
    this.timeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.transport.onMessage((m) => this.handleMessage(m));
  }

  private handleMessage(m: JsonRpcMessage): void {
    if (m.id === undefined || typeof m.id !== 'number') return; // ignore notifications
    const entry = this.pending.get(m.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(m.id);
    if (m.error) entry.reject(new Error(`MCP error ${m.error.code}: ${m.error.message}`));
    else entry.resolve(m.result);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params?: unknown): void {
    this.transport.send({ jsonrpc: '2.0', method, params });
  }

  /** Start the transport and perform the MCP initialize handshake. */
  async initialize(): Promise<void> {
    await this.transport.start();
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: this.opts.clientName ?? 'thinkco',
        version: this.opts.clientVersion ?? '0.1.0',
      },
    });
    this.notify('notifications/initialized');
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.request('tools/list')) as { tools?: McpTool[] } | undefined;
    return result?.tools ?? [];
  }

  /** Call a tool; returns concatenated text content. */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = (await this.request('tools/call', { name, arguments: args })) as
      | { content?: Array<{ type: string; text?: string }>; isError?: boolean }
      | undefined;
    const text = (result?.content ?? [])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
      .join('\n');
    return { text, isError: result?.isError ?? false };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
