/** Telegram transport abstraction so the frontend can be tested with a mock. */
import { logger } from '../../util/logger.js';
import { errorWithCause } from '../../util/errors.js';

export interface InlineButton {
  text: string;
  data: string;
}

export interface TelegramUpdate {
  kind: 'message' | 'callback';
  chatId: number;
  userId: number;
  /** message text (for kind=message) */
  text?: string;
  /** callback payload (for kind=callback) */
  data?: string;
  callbackId?: string;
  messageId?: number;
}

export interface TelegramBotInfo {
  id: number;
  username?: string;
  first_name?: string;
}

export type TelegramChatAction = 'typing' | 'upload_document' | 'find_location';

export interface TelegramTransport {
  sendMessage(chatId: number, text: string): Promise<number>;
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
  deleteMessage?(chatId: number, messageId: number): Promise<void>;
  sendChatAction?(chatId: number, action: TelegramChatAction): Promise<void>;
  sendButtons(chatId: number, text: string, buttons: InlineButton[]): Promise<number>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  /** Verify the token and return the bot's identity (Telegram getMe). Optional on mocks. */
  getMe?(): Promise<TelegramBotInfo>;
  /** Subscribe to incoming updates (long-poll/webhook). */
  onUpdate(handler: (update: TelegramUpdate) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Real Bot API transport using long polling. Untested here (needs a bot token). */
export class HttpTelegramTransport implements TelegramTransport {
  private handler?: (u: TelegramUpdate) => void;
  private offset = 0;
  private running = false;
  private readonly api: string;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.api = `https://api.telegram.org/bot${token}`;
  }

  private async call(method: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.api}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
    return (json.result ?? {}) as Record<string, unknown>;
  }

  async sendMessage(chatId: number, text: string): Promise<number> {
    const r = await this.call('sendMessage', { chat_id: chatId, text });
    return r.message_id as number;
  }

  async getMe(): Promise<TelegramBotInfo> {
    const r = await this.call('getMe', {});
    return { id: r.id as number, username: r.username as string | undefined, first_name: r.first_name as string | undefined };
  }

  async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
    await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text });
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  async sendChatAction(chatId: number, action: TelegramChatAction): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action });
  }

  async sendButtons(chatId: number, text: string, buttons: InlineButton[]): Promise<number> {
    const r = await this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] },
    });
    return r.message_id as number;
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  onUpdate(handler: (u: TelegramUpdate) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.running = true;
    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const updates = (await this.call('getUpdates', { offset: this.offset, timeout: 30 })) as unknown as Array<
          Record<string, unknown>
        >;
        for (const u of updates) this.dispatch(u);
      } catch (err) {
        logger.warn(`Telegram polling failed: ${errorWithCause(err)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private dispatch(u: Record<string, unknown>): void {
    this.offset = Math.max(this.offset, (u.update_id as number) + 1);
    const message = u.message as Record<string, unknown> | undefined;
    const callback = u.callback_query as Record<string, unknown> | undefined;
    if (message) {
      const from = message.from as Record<string, unknown>;
      const chat = message.chat as Record<string, unknown>;
      this.handler?.({
        kind: 'message',
        chatId: chat.id as number,
        userId: from.id as number,
        text: message.text as string,
      });
    } else if (callback) {
      const from = callback.from as Record<string, unknown>;
      const msg = callback.message as Record<string, unknown>;
      this.handler?.({
        kind: 'callback',
        chatId: (msg.chat as Record<string, unknown>).id as number,
        userId: from.id as number,
        data: callback.data as string,
        callbackId: callback.id as string,
        messageId: msg.message_id as number,
      });
    }
  }
}
