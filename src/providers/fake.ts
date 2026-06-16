/**
 * Fake provider — deterministic, offline. Used for tests and as a default when
 * no real provider is configured. Emits scripted turns.
 */
import type {
  ChatOptions,
  Message,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ToolCall,
  ToolDef,
} from '../types/index.js';

export interface ScriptedTurn {
  /** Text chunks to stream as the assistant message. */
  text?: string[];
  /** Tool calls to emit this turn. */
  toolCalls?: ToolCall[];
}

export interface FakeProviderOptions {
  /** Queue of scripted turns; consumed one per chat() call. */
  script?: ScriptedTurn[];
  /** Echo the last user message text back if no script remains. */
  echo?: boolean;
}

export class FakeProvider implements ProviderAdapter {
  readonly name = 'fake';
  readonly capabilities: ProviderCapabilities = {
    tools: true,
    streaming: true,
    systemPrompt: true,
  };

  private readonly script: ScriptedTurn[];
  private readonly echo: boolean;

  constructor(opts: FakeProviderOptions = {}) {
    this.script = [...(opts.script ?? [])];
    this.echo = opts.echo ?? true;
  }

  async *chat(
    messages: Message[],
    _tools: ToolDef[],
    _opts: ChatOptions,
  ): AsyncIterable<ProviderEvent> {
    const turn = this.script.shift();

    if (turn) {
      for (const chunk of turn.text ?? []) {
        yield { type: 'text', text: chunk };
      }
      for (const call of turn.toolCalls ?? []) {
        yield { type: 'tool_call', call };
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: 'stop', reason: (turn.toolCalls?.length ?? 0) > 0 ? 'tool_use' : 'end_turn' };
      return;
    }

    if (this.echo) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const text = lastUser
        ? lastUser.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as { text: string }).text)
            .join(' ')
        : '';
      yield { type: 'text', text: `echo: ${text}` };
    }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'stop', reason: 'end_turn' };
  }
}
