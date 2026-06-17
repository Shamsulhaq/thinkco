/** Transcript export: render the conversation as readable Markdown. */
import type { Message } from '../types/index.js';

function blockText(m: Message): string {
  return m.content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `\u0060${b.name}(\u0060 ${JSON.stringify(b.input)} \u0060)\u0060`;
      if (b.type === 'tool_result') return `→ ${b.content}`;
      if (b.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const ROLE_HEADING: Record<string, string> = {
  user: '## 🧑 User',
  assistant: '## 🤖 Assistant',
  tool: '### 🔧 Tool result',
  system: '### ⚙️ System',
};

/** Render messages as a Markdown transcript with a title and per-message sections. */
export function formatTranscript(messages: Message[], title = 'thinkco session'): string {
  const lines: string[] = [`# ${title}`, `_${new Date().toISOString()}_`, ''];
  for (const m of messages) {
    const text = blockText(m).trim();
    if (!text) continue;
    lines.push(ROLE_HEADING[m.role] ?? `## ${m.role}`);
    lines.push(text, '');
  }
  return lines.join('\n');
}
