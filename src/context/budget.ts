/** Token budgeting + conversation compaction. */
import type { Message, ProviderAdapter } from '../types/index.js';
import { countTokens } from './tokenizer.js';

/** Token estimate through the active tokenizer (heuristic by default). */
export function estimateTokens(text: string): number {
  return countTokens(text);
}

export function messageText(msg: Message): string {
  return msg.content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return JSON.stringify(b.input);
      if (b.type === 'tool_result') return b.content;
      return '';
    })
    .join(' ');
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0);
}

export interface CompactionOptions {
  /** Token budget that triggers compaction. */
  maxTokens: number;
  /** How many of the most recent messages to always keep verbatim. */
  keepRecent?: number;
  /** Optional LLM summarizer; falls back to a heuristic if omitted. */
  summarize?: (messages: Message[]) => Promise<string>;
}

/** Heuristic summary used when no LLM summarizer is provided. */
function heuristicSummary(messages: Message[]): string {
  const lines = messages.map((m) => {
    const text = messageText(m).replace(/\s+/g, ' ').trim();
    return `- ${m.role}: ${text.slice(0, 200)}`;
  });
  return `Summary of ${messages.length} earlier messages:\n${lines.join('\n')}`;
}

/**
 * Compact a conversation if it exceeds the token budget: summarize older messages
 * into a single system-context message and keep the most recent ones verbatim.
 */
export async function compactConversation(
  messages: Message[],
  opts: CompactionOptions,
): Promise<{ messages: Message[]; compacted: boolean }> {
  if (estimateMessagesTokens(messages) <= opts.maxTokens) {
    return { messages, compacted: false };
  }
  const keepRecent = opts.keepRecent ?? 6;
  if (messages.length <= keepRecent + 1) return { messages, compacted: false };

  const older = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(messages.length - keepRecent);

  const summary = opts.summarize ? await opts.summarize(older) : heuristicSummary(older);
  const summaryMessage: Message = {
    role: 'user',
    content: [{ type: 'text', text: `[Earlier conversation summary]\n${summary}` }],
  };
  return { messages: [summaryMessage, ...recent], compacted: true };
}

/** Build an LLM summarizer backed by a provider adapter. */
export function providerSummarizer(
  provider: ProviderAdapter,
  model: string,
): (messages: Message[]) => Promise<string> {
  return async (messages) => {
    const transcript = messages.map((m) => `${m.role}: ${messageText(m)}`).join('\n');
    const prompt: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Summarize the following conversation concisely, preserving decisions, file paths, and open tasks:\n\n${transcript}`,
          },
        ],
      },
    ];
    let out = '';
    for await (const evt of provider.chat(prompt, [], { model })) {
      if (evt.type === 'text') out += evt.text;
    }
    return out.trim() || 'Summary unavailable.';
  };
}
