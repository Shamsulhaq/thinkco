/** Concise, optional rendering of streamed extended-thinking output. */

/**
 * Collapse a (possibly long, multi-line) thinking buffer into a single concise line for a
 * progress indicator — whitespace-collapsed and trimmed to the trailing `max` characters.
 */
export function formatThinking(buffer: string, max = 160): string {
  const oneLine = buffer.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `…${oneLine.slice(oneLine.length - max)}`;
}
