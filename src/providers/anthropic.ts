/** Anthropic Messages API adapter. */
import type {
  ChatOptions,
  Message,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ToolDef,
} from '../types/index.js';
import type { StopReason } from '../types/index.js';
import { ProviderError } from '../util/errors.js';
import { fetchWithRetry } from '../util/retry.js';
import { iterateSse } from '../util/stream.js';

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  version?: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicContentParam {
  type: string;
  [k: string]: unknown;
}

/** Convert unified messages to Anthropic's request shape. */
export function toAnthropicMessages(messages: Message[]): {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: AnthropicContentParam[] }>;
} {
  let system: string | undefined;
  const out: Array<{ role: 'user' | 'assistant'; content: AnthropicContentParam[] }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      continue;
    }
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    const content: AnthropicContentParam[] = msg.content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError ?? false,
          };
        case 'image':
          return {
            type: 'image',
            source:
              block.source.type === 'base64'
                ? {
                    type: 'base64',
                    media_type: block.source.mediaType,
                    data: block.source.data,
                  }
                : {
                    type: 'url',
                    url: block.source.url,
                  },
          };
      }
    });
    out.push({ role, content });
  }
  return { system, messages: out };
}

export function toAnthropicTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic';
  readonly capabilities: ProviderCapabilities = { tools: true, streaming: true, systemPrompt: true };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions) {
    if (!opts.apiKey) throw new ProviderError('Anthropic adapter requires an API key', false);
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
    this.version = opts.version ?? '2023-06-01';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts: ChatOptions,
  ): AsyncIterable<ProviderEvent> {
    const { system, messages: amsgs } = toAnthropicMessages(messages);
    const body = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature,
      system: opts.system ?? system,
      messages: amsgs,
      tools: tools.length ? toAnthropicTools(tools) : undefined,
      stream: true,
    };

    const res = await fetchWithRetry(
      this.fetchImpl,
      `${this.baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      { signal: opts.signal },
    );

    yield* parseAnthropicStream(res.body);
  }
}

/** Parse the Anthropic SSE stream into unified ProviderEvents. */
export async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<ProviderEvent> {
  // Track in-progress tool_use blocks by index.
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = 'end_turn';

  for await (const data of iterateSse(body)) {
    if (!data || data === '[DONE]') continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = evt.type as string;

    if (type === 'message_start') {
      const usage = (evt.message as Record<string, unknown> | undefined)?.usage as
        | Record<string, number>
        | undefined;
      if (usage) inputTokens = usage.input_tokens ?? 0;
    } else if (type === 'content_block_start') {
      const index = evt.index as number;
      const block = evt.content_block as Record<string, unknown>;
      if (block?.type === 'tool_use') {
        toolBlocks.set(index, { id: block.id as string, name: block.name as string, json: '' });
      }
    } else if (type === 'content_block_delta') {
      const index = evt.index as number;
      const delta = evt.delta as Record<string, unknown>;
      if (delta?.type === 'text_delta') {
        yield { type: 'text', text: delta.text as string };
      } else if (delta?.type === 'input_json_delta') {
        const tb = toolBlocks.get(index);
        if (tb) tb.json += (delta.partial_json as string) ?? '';
      }
    } else if (type === 'content_block_stop') {
      const index = evt.index as number;
      const tb = toolBlocks.get(index);
      if (tb) {
        let input: Record<string, unknown> = {};
        try {
          input = tb.json ? (JSON.parse(tb.json) as Record<string, unknown>) : {};
        } catch {
          input = {};
        }
        yield { type: 'tool_call', call: { id: tb.id, name: tb.name, input } };
        toolBlocks.delete(index);
      }
    } else if (type === 'message_delta') {
      const usage = evt.usage as Record<string, number> | undefined;
      if (usage?.output_tokens) outputTokens = usage.output_tokens;
      const delta = evt.delta as Record<string, unknown> | undefined;
      const sr = delta?.stop_reason as string | undefined;
      if (sr) stopReason = mapAnthropicStop(sr);
    } else if (type === 'message_stop') {
      yield { type: 'usage', usage: { inputTokens, outputTokens } };
      yield { type: 'stop', reason: stopReason };
    }
  }
}

function mapAnthropicStop(sr: string): StopReason {
  switch (sr) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'end_turn':
    default:
      return 'end_turn';
  }
}
