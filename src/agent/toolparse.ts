/**
 * Fallback tool-call extraction for models that emit tool calls as text/JSON instead of
 * using the provider's native tool_calls channel (common with local models via Ollama).
 * Recognizes objects like {"name":"read","arguments":{...}} wherever they appear
 * (fenced code blocks, <tool_call> tags, or inline).
 */
import type { ToolCall } from '../types/index.js';

/** Yield balanced top-level {...} substrings from text (ignores nested objects). */
function* balancedObjects(text: string): Generator<string> {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          yield text.slice(i, j + 1);
          i = j;
          break;
        }
      }
    }
  }
}

/** True if any string value looks like a documentation placeholder, e.g. "<file-path>". */
function hasPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return /<[^>\n]+>/.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (value && typeof value === 'object') return Object.values(value).some(hasPlaceholder);
  return false;
}

/** Extract tool calls embedded in assistant text. Only returns calls for known tool names. */
export function extractTextToolCalls(text: string, validNames: Set<string>): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  let counter = 0;

  for (const raw of balancedObjects(text)) {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const rec = obj as Record<string, unknown>;
    const name = rec.name ?? rec.tool ?? rec.tool_name;
    const args = rec.arguments ?? rec.parameters ?? rec.input ?? rec.args;
    if (typeof name !== 'string' || !validNames.has(name)) continue;
    if (!args || typeof args !== 'object') continue;
    // Skip documentation/example calls whose values are placeholders like "<file-path>".
    if (hasPlaceholder(args)) continue;
    const key = `${name}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ id: `txt_${counter++}`, name, input: args as Record<string, unknown> });
  }

  return calls;
}
