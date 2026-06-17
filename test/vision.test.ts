import { describe, it, expect } from 'vitest';
import { toAnthropicMessages, AnthropicAdapter } from '../src/providers/anthropic.js';
import { toOpenAIMessages, OpenAIAdapter } from '../src/providers/openai.js';
import { GeminiAdapter } from '../src/providers/gemini.js';
import { isImagePath, mediaTypeFromPath, imageBlockFromUrl } from '../src/util/image.js';
import type { Message } from '../src/types/index.js';

const imgMsg: Message = {
  role: 'user',
  content: [
    { type: 'text', text: 'what is this?' },
    { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } },
  ],
};

describe('image/vision input', () => {
  it('maps an image block to Anthropic image source', () => {
    const { messages } = toAnthropicMessages([imgMsg]);
    const parts = messages[0]!.content;
    expect(parts).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(parts).toContainEqual({ type: 'text', text: 'what is this?' });
  });

  it('maps an image block to an OpenAI image_url data URL', () => {
    const out = toOpenAIMessages([imgMsg]);
    const content = out[0]!.content as Array<Record<string, unknown>>;
    expect(content).toContainEqual({ type: 'text', text: 'what is this?' });
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('declares vision capability on Anthropic and OpenAI but not native Gemini', () => {
    expect(new AnthropicAdapter({ apiKey: 'k' }).capabilities.vision).toBe(true);
    expect(new OpenAIAdapter({ apiKey: 'k' }).capabilities.vision).toBe(true);
    expect(new GeminiAdapter({ apiKey: 'k' }).capabilities.vision).toBeUndefined();
  });

  it('image helpers detect type and build url blocks', () => {
    expect(isImagePath('shot.png')).toBe(true);
    expect(isImagePath('notes.txt')).toBe(false);
    expect(mediaTypeFromPath('a.jpg')).toBe('image/jpeg');
    expect(imageBlockFromUrl('https://x/y.png')).toEqual({ type: 'image', source: { type: 'url', url: 'https://x/y.png' } });
  });
});
