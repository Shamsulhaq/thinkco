/** OpenAI Chat Completions API adapter (also compatible with OpenAI-style endpoints). */
import type {
  ChatOptions,
  Message,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  StopReason,
  ToolDef,
} from '../types/index.js';
import { ProviderError } from '../util/errors.js';
import { fetchWithRetry } from '../util/retry.js';
import { iterateSse } from '../util/stream.js';

export interface OpenAIOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<Record<string, unknown>> | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Convert unified messages to OpenAI chat message array. */
export function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      out.push({
        role: 'system',
        content: msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n'),
      });
      continue;
    }
    if (msg.role === 'tool') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
        }
      }
      continue;
    }
    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      const toolUses = msg.content.filter((b) => b.type === 'tool_use') as Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }>;
      const m: OpenAIMessage = { role: 'assistant', content: text || null };
      if (toolUses.length) {
        m.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        }));
      }
      out.push(m);
      continue;
    }
    // user
    const toolResults = msg.content.filter((b) => b.type === 'tool_result');
    if (toolResults.length) {
      for (const block of toolResults) {
        if (block.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
        }
      }
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const block of msg.content) {
      if (block.type === 'text') parts.push({ type: 'text', text: block.text });
      if (block.type === 'image') {
        const url =
          block.source.type === 'base64'
            ? `data:${block.source.mediaType};base64,${block.source.data}`
            : block.source.url;
        parts.push({ type: 'image_url', image_url: { url } });
      }
    }
    if (parts.length === 1 && parts[0]?.type === 'text') out.push({ role: 'user', content: parts[0].text as string });
    else if (parts.length) out.push({ role: 'user', content: parts });
  }
  return out;
}

export function toOpenAITools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai';
  readonly capabilities: ProviderCapabilities = { tools: true, streaming: true, systemPrompt: true, vision: true };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAIOptions) {
    if (!opts.apiKey) throw new ProviderError('OpenAI adapter requires an API key', false);
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts: ChatOptions,
  ): AsyncIterable<ProviderEvent> {
    const all = opts.system
      ? [{ role: 'system' as const, content: opts.system }, ...toOpenAIMessages(messages)]
      : toOpenAIMessages(messages);

    const body = {
      model: opts.model,
      messages: all,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      tools: tools.length ? toOpenAITools(tools) : undefined,
      stream: true,
      stream_options: { include_usage: true },
    };

    const res = await fetchWithRetry(
      this.fetchImpl,
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      { signal: opts.signal },
    );

    yield* parseOpenAIStream(res.body);
  }
}

interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

/** Parse OpenAI's SSE stream into unified ProviderEvents. */
export async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<ProviderEvent> {
  const toolCalls = new Map<number, PartialToolCall>();
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

    const usage = evt.usage as Record<string, number> | null | undefined;
    if (usage) {
      inputTokens = usage.prompt_tokens ?? inputTokens;
      outputTokens = usage.completion_tokens ?? outputTokens;
    }

    const choices = evt.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice) continue;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (delta?.content) {
      yield { type: 'text', text: delta.content as string };
    }
    const deltaToolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (deltaToolCalls) {
      for (const tc of deltaToolCalls) {
        const index = (tc.index as number) ?? 0;
        const existing = toolCalls.get(index) ?? { id: '', name: '', args: '' };
        if (tc.id) existing.id = tc.id as string;
        const fn = tc.function as Record<string, unknown> | undefined;
        if (fn?.name) existing.name = fn.name as string;
        if (fn?.arguments) existing.args += fn.arguments as string;
        toolCalls.set(index, existing);
      }
    }

    const finish = choice.finish_reason as string | null | undefined;
    if (finish) {
      stopReason = mapOpenAIStop(finish);
      // Emit accumulated tool calls in index order.
      for (const tc of [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
        let input: Record<string, unknown> = {};
        try {
          input = tc.args ? (JSON.parse(tc.args) as Record<string, unknown>) : {};
        } catch {
          input = {};
        }
        yield { type: 'tool_call', call: { id: tc.id, name: tc.name, input } };
      }
      toolCalls.clear();
    }
  }

  yield { type: 'usage', usage: { inputTokens, outputTokens } };
  yield { type: 'stop', reason: stopReason };
}

function mapOpenAIStop(reason: string): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
    default:
      return 'end_turn';
  }
}
