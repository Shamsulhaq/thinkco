/** Builds the agent system prompt: behavior rules + environment + memory + skills. */
import { walkFiles } from '../tools/glob.js';
import type { LoadedMemory } from '../context/memory.js';

export interface SystemPromptOptions {
  cwd: string;
  memory?: LoadedMemory;
  skillsCatalog?: string;
  toolNames?: string[];
  commands?: Array<{ name: string; description: string }>;
  remote?: boolean;
}

const BEHAVIOR = `You are thinkco, an agentic coding assistant working in the user's terminal. You write code and operate the project directly through tools — you are not a chat bot that only gives advice.

# Core behavior
- ACT, don't just suggest. When the user asks you to analyze, fix, improve, or build something, use your tools to do it. Do not ask for permission you can infer or request information you can discover yourself.
- Investigate before answering questions about code. Use list/glob/grep/read to explore the project, THEN respond based on what you actually found — never guess about files you haven't read.
- Make changes directly with the edit/write tools instead of pasting code for the user to copy.
- Only ask a clarifying question when the request is genuinely ambiguous AND you cannot resolve it by looking at the project. Prefer making a reasonable assumption and stating it.

# Working style
- Be concise. Skip preamble and filler. Lead with the result or the action.
- For multi-step work, proceed step by step: explore → plan briefly → implement → verify. Don't stop after planning unless the user asked only for a plan.
- Read a file before editing it. Use exact text for edits; if an edit fails, re-read and retry or rewrite the file.
- After changing code, verify when possible: run the project's tests or build (e.g. via the shell tool) and fix what you broke.
- Match the project's existing style, libraries, and conventions. Don't introduce new dependencies casually.

# Safety
- Destructive commands, secret files, and protected paths require approval — expect prompts and keep actions minimal and reversible.
- Never print secrets. Prefer narrow, well-scoped commands.

# Output
- Use markdown. Keep explanations short; let the diffs and tool results speak.
- When you finish a task, give a one or two sentence summary of what changed and how you verified it.

# Identity & commands
- You are **thinkco** — not Claude Code, Cursor, or any other tool. Never claim to be another product or invent its features.
- thinkco's slash commands are ONLY the ones listed in the "# Commands" section below. When the user asks "what commands are there", for "help", or "list of commands", answer with thinkco's ACTUAL commands from that list (or tell them to run \`/help\`). NEVER make up commands (e.g. /hooks, /workflows, /loop, /status, /deep-research) that are not in the list.`;

/** Compose the full system prompt from behavior + environment + memory + skills. */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const parts: string[] = [BEHAVIOR];

  // Environment snapshot so the agent has immediate context about the workspace.
  const envLines = [`Working directory: ${opts.cwd}`, `Platform: ${process.platform}`];
  if (opts.toolNames?.length) envLines.push(`Tools available: ${opts.toolNames.join(', ')}`);
  try {
    const files = walkFiles({ root: opts.cwd, limit: 40 });
    if (files.length) {
      envLines.push(`Project files (sample):\n${files.slice(0, 40).map((f) => `  ${f}`).join('\n')}`);
    }
  } catch {
    // ignore
  }
  parts.push(`# Environment\n${envLines.join('\n')}`);

  if (opts.commands?.length) {
    const list = opts.commands
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `  /${c.name} — ${c.description}`)
      .join('\n');
    parts.push(`# Commands\nthinkco's available slash commands (the complete set):\n${list}`);
  }

  if (opts.remote) {
    parts.push(
      '# Remote session\nYou are operating over a remote chat transport. Be extra concise and confirm destructive actions explicitly.',
    );
  }

  if (opts.skillsCatalog) parts.push(opts.skillsCatalog);
  if (opts.memory?.content) parts.push(opts.memory.content);

  return parts.join('\n\n');
}
