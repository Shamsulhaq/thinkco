/** MCP transports: newline-delimited JSON-RPC 2.0. */
import { spawn, type ChildProcess } from 'node:child_process';
import { iterateSse } from '../util/stream.js';

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface Transport {
  start(): Promise<void>;
  send(message: JsonRpcMessage): void;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  close(): Promise<void>;
}

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** Spawns a subprocess and exchanges newline-delimited JSON-RPC over stdio. */
export class StdioTransport implements Transport {
  private child?: ChildProcess;
  private handler?: (m: JsonRpcMessage) => void;
  private buffer = '';

  constructor(private readonly opts: StdioTransportOptions) {}

  async start(): Promise<void> {
    this.child = spawn(this.opts.command, this.opts.args ?? [], {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    await new Promise<void>((resolve, reject) => {
      this.child?.once('spawn', () => resolve());
      this.child?.once('error', reject);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        this.handler?.(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // ignore non-JSON lines (e.g. server logging to stdout)
      }
    }
  }

  send(message: JsonRpcMessage): void {
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.child?.kill();
  }
}

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/**
 * MCP over HTTP (Streamable HTTP, simplified): each JSON-RPC message is POSTed to the URL.
 * Responses may be a single JSON object or an SSE stream of `data:` JSON events; both are
 * delivered to the message handler. Notifications (no id) are fire-and-forget.
 */
export class HttpTransport implements Transport {
  private handler?: (m: JsonRpcMessage) => void;
  private readonly fetchImpl: typeof fetch;
  private sessionId?: string;

  constructor(private readonly opts: HttpTransportOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    // No persistent connection needed for the POST-based flow.
  }

  send(message: JsonRpcMessage): void {
    void this.post(message);
  }

  private async post(message: JsonRpcMessage): Promise<void> {
    try {
      const res = await this.fetchImpl(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
          ...this.opts.headers,
        },
        body: JSON.stringify(message),
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (message.id === undefined) return; // notification — ignore response

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        for await (const data of iterateSse(res.body)) {
          if (!data || data === '[DONE]') continue;
          this.deliver(data);
        }
      } else {
        this.deliver(await res.text());
      }
    } catch {
      // Surface as a timeout/no-response; McpClient request will reject on its own timer.
    }
  }

  private deliver(raw: string): void {
    try {
      this.handler?.(JSON.parse(raw) as JsonRpcMessage);
    } catch {
      // ignore non-JSON
    }
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    // Stateless; nothing to tear down.
  }
}
