/** Ollama local model adapter (/api/chat, NDJSON streaming). */
import type {
  ChatOptions,
  Message,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  StopReason,
  ToolDef,
} from '../types/index.js';
import { fetchWithRetry } from '../util/retry.js';
import { iterateLines } from '../util/stream.js';

export interface OllamaOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

export function toOllamaMessages(messages: Message[]): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  for (const msg of messages) {
    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
    if (msg.role === 'tool') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') out.push({ role: 'tool', content: block.content });
      }
      continue;
    }
    if (msg.role === 'assistant') {
      const toolUses = msg.content.filter((b) => b.type === 'tool_use') as Array<{
        name: string;
        input: Record<string, unknown>;
      }>;
      const m: OllamaMessage = { role: 'assistant', content: text };
      if (toolUses.length) {
        m.tool_calls = toolUses.map((t) => ({ function: { name: t.name, arguments: t.input } }));
      }
      out.push(m);
      continue;
    }
    const role = msg.role === 'system' ? 'system' : 'user';
    // Surface tool_result blocks on user turns as tool messages.
    for (const block of msg.content) {
      if (block.type === 'tool_result') out.push({ role: 'tool', content: block.content });
    }
    if (text) out.push({ role, content: text });
  }
  return out;
}

export function toOllamaTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export class OllamaAdapter implements ProviderAdapter {
  readonly name = 'ollama';
  readonly capabilities: ProviderCapabilities = { tools: true, streaming: true, systemPrompt: true };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'http://localhost:11434';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts: ChatOptions,
  ): AsyncIterable<ProviderEvent> {
    const msgs = opts.system
      ? [{ role: 'system' as const, content: opts.system }, ...toOllamaMessages(messages)]
      : toOllamaMessages(messages);

    const body = {
      model: opts.model,
      messages: msgs,
      tools: tools.length ? toOllamaTools(tools) : undefined,
      stream: true,
      options: opts.temperature !== undefined ? { temperature: opts.temperature } : undefined,
    };

    const res = await fetchWithRetry(
      this.fetchImpl,
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      { signal: opts.signal },
    );

    yield* parseOllamaStream(res.body);
  }
}

/** Parse Ollama NDJSON stream into unified ProviderEvents. */
export async function* parseOllamaStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<ProviderEvent> {
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = 'end_turn';
  let counter = 0;

  for await (const line of iterateLines(body)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const message = evt.message as Record<string, unknown> | undefined;
    if (message?.content) {
      yield { type: 'text', text: message.content as string };
    }
    const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        stopReason = 'tool_use';
        yield {
          type: 'tool_call',
          call: {
            id: `ollama_${counter++}`,
            name: fn.name as string,
            input: (fn.arguments as Record<string, unknown>) ?? {},
          },
        };
      }
    }

    if (evt.done === true) {
      inputTokens = (evt.prompt_eval_count as number) ?? 0;
      outputTokens = (evt.eval_count as number) ?? 0;
      yield { type: 'usage', usage: { inputTokens, outputTokens } };
      yield { type: 'stop', reason: stopReason };
    }
  }
}
