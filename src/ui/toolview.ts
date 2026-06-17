/** Helpers for rich tool display: status icons and collapsible output. */
export type ToolStatus = 'running' | 'success' | 'error';

/** Status glyph for a tool call's lifecycle state. */
export function statusIcon(status: ToolStatus): string {
  switch (status) {
    case 'running':
      return '⏺';
    case 'success':
      return '✓';
    case 'error':
      return '✗';
  }
}

export interface CollapsedOutput {
  text: string;
  hiddenLines: number;
}

/** Collapse long output to the first `maxLines` lines, reporting how many were hidden. */
export function collapseOutput(output: string, maxLines = 12): CollapsedOutput {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return { text: output, hiddenLines: 0 };
  return { text: lines.slice(0, maxLines).join('\n'), hiddenLines: lines.length - maxLines };
}

/** Render a tool result preview with a status icon and a collapsed-output footer. */
export function formatToolResult(output: string, isError: boolean, maxLines = 12): string {
  const { text, hiddenLines } = collapseOutput(output, maxLines);
  const icon = statusIcon(isError ? 'error' : 'success');
  const body = text || '(no output)';
  return hiddenLines > 0 ? `${icon} ${body}\n… +${hiddenLines} more line(s)` : `${icon} ${body}`;
}
