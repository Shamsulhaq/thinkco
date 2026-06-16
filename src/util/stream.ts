/** Stream parsing helpers shared by provider adapters. */

/**
 * Async-iterate over decoded text lines from a fetch Response body.
 * Works with ReadableStream<Uint8Array>.
 */
export async function* iterateLines(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse Server-Sent Events from a line stream, yielding the `data:` payloads.
 * Skips comments and event-name lines; stops payloads marked `[DONE]` are passed through.
 */
export async function* iterateSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<string> {
  for await (const line of iterateLines(body)) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('data:')) {
      yield trimmed.slice(5).trimStart();
    }
  }
}

/** Build a ReadableStream from string chunks — useful for tests. */
export function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Wrap an async iterable so that if no value arrives within `ms`, it throws a stall error.
 * The timer resets on every yielded value (idle timeout, not total).
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  ms: number,
  onTimeout: () => Error,
): AsyncIterable<T> {
  const iterator = source[Symbol.asyncIterator]();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    });
    try {
      const result = await Promise.race([iterator.next(), timeout]);
      if (result.done) return;
      yield result.value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
