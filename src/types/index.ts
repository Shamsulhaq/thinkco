/**
 * Unified internal types — the contract every provider adapter and tool conforms to.
 * Provider-specific wire formats must never leak above the adapter boundary.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface ImageBlock {
  type: 'image';
  source:
    | {
        type: 'base64';
        mediaType: string;
        data: string;
      }
    | {
        type: 'url';
        url: string;
      };
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export interface Message {
  role: Role;
  content: ContentBlock[];
}

/** A tool definition exposed to the model. inputSchema is JSON Schema. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  output: string;
  isError?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';

/** Streaming events emitted by a ProviderAdapter.chat() call. */
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'stop'; reason: StopReason };

export interface ChatOptions {
  model: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
  signal?: AbortSignal;
}

/** Capability flags so the core can adapt to provider differences. */
export interface ProviderCapabilities {
  tools: boolean;
  streaming: boolean;
  systemPrompt: boolean;
  vision?: boolean;
  thinking?: boolean;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  chat(
    messages: Message[],
    tools: ToolDef[],
    opts: ChatOptions,
  ): AsyncIterable<ProviderEvent>;
}
