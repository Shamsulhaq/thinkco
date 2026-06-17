/** Google Gemini (Generative Language API) native adapter. */
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

export interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Convert unified messages to Gemini's `contents` array (+ optional system instruction).
 * Gemini has no tool-call ids: function responses are matched by name, so we track the
 * tool_use id → name mapping while walking the conversation.
 */
export function toGeminiContents(messages: Message[]): {
  system?: string;
  contents: GeminiContent[];
} {
  let system: string | undefined;
  const contents: GeminiContent[] = [];
  const toolNames = new Map<string, string>(); // tool_use id → function name

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      system = system ? `${system}\n${text}` : text;
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: GeminiPart[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          if (block.text) parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          toolNames.set(block.id, block.name);
          parts.push({ functionCall: { name: block.name, args: block.input } });
        }
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    // user or tool role → role 'user' for Gemini.
    const parts: GeminiPart[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        if (block.text) parts.push({ text: block.text });
      } else if (block.type === 'tool_result') {
        const name = toolNames.get(block.toolUseId) ?? block.toolUseId;
        parts.push({
          functionResponse: {
            name,
            response: block.isError ? { error: block.content } : { output: block.content },
          },
        });
      }
    }
    if (parts.length) contents.push({ role: 'user', parts });
  }

  return { system, contents };
}

/** Convert unified tool defs to Gemini's functionDeclarations wrapper. */
export function toGeminiTools(tools: ToolDef[]): unknown[] {
  if (!tools.length) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

export function mapGeminiStop(reason: string | undefined): StopReason {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'STOP':
    case 'FINISH_REASON_UNSPECIFIED':
    case undefined:
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini';
  readonly capabilities: ProviderCapabilities = { tools: true, streaming: true, systemPrompt: true };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey) throw new ProviderError('Gemini adapter requires an API key', false);
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    opts: ChatOptions,
  ): AsyncIterable<ProviderEvent> {
    const { system, contents } = toGeminiContents(messages);
    const systemText = opts.system ?? system;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
      },
    };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (tools.length) {
      body.tools = toGeminiTools(tools);
    }

    const url = `${this.baseUrl}/models/${opts.model}:streamGenerateContent?alt=sse`;
    const res = await fetchWithRetry(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      { signal: opts.signal },
    );

    yield* parseGeminiStream(res.body);
  }
}

/** Parse Gemini's SSE stream (`alt=sse`) into unified ProviderEvents. */
export async function* parseGeminiStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<ProviderEvent> {
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = 'end_turn';
  let sawToolCall = false;
  let toolSeq = 0;

  for await (const data of iterateSse(body)) {
    if (!data || data === '[DONE]') continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const usage = evt.usageMetadata as Record<string, number> | undefined;
    if (usage) {
      inputTokens = usage.promptTokenCount ?? inputTokens;
      outputTokens = usage.candidatesTokenCount ?? outputTokens;
    }

    const candidates = evt.candidates as Array<Record<string, unknown>> | undefined;
    const candidate = candidates?.[0];
    if (!candidate) continue;

    const content = candidate.content as { parts?: GeminiPart[] } | undefined;
    for (const part of content?.parts ?? []) {
      if ('text' in part && part.text) {
        yield { type: 'text', text: part.text };
      } else if ('functionCall' in part && part.functionCall) {
        sawToolCall = true;
        const fc = part.functionCall;
        yield {
          type: 'tool_call',
          call: { id: `gemini-${Date.now()}-${toolSeq++}`, name: fc.name, input: fc.args ?? {} },
        };
      }
    }

    const finish = candidate.finishReason as string | undefined;
    if (finish) stopReason = mapGeminiStop(finish);
  }

  if (sawToolCall) stopReason = 'tool_use';
  yield { type: 'usage', usage: { inputTokens, outputTokens } };
  yield { type: 'stop', reason: stopReason };
}
