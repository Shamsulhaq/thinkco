/** Terminal window-title progress via OSC escape sequences. */

/** The OSC sequence that sets the terminal window/tab title. */
export function titleSequence(text: string): string {
  return `\u001b]0;${text}\u0007`;
}

export interface TitleState {
  busy: boolean;
  elapsedSec?: number;
  toolCount?: number;
  error?: boolean;
}

/** Compose a concise window title from the agent's activity state. */
export function composeTitle(state: TitleState, base = 'thinkco'): string {
  if (state.error) return `${base} · error`;
  if (!state.busy) return `${base} · ready`;
  let t = `${base} · working ${Math.max(0, Math.round(state.elapsedSec ?? 0))}s`;
  if (state.toolCount) t += ` · ${state.toolCount} tool${state.toolCount > 1 ? 's' : ''}`;
  return t;
}

/** Write a title to the terminal if the stream is a TTY (no-op otherwise). */
export function setTerminalTitle(
  text: string,
  stream: { isTTY?: boolean; write(s: string): unknown } = process.stdout,
): void {
  if (!stream.isTTY) return;
  stream.write(titleSequence(text));
}
