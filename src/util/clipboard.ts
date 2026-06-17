/** Clipboard helper: copy text via the platform clipboard tool, with a graceful fallback. */
import { spawnSync } from 'node:child_process';

/** The clipboard command + args for a platform, or undefined if unknown. */
export function clipboardCommand(platform: NodeJS.Platform): { cmd: string; args: string[] } | undefined {
  switch (platform) {
    case 'darwin':
      return { cmd: 'pbcopy', args: [] };
    case 'win32':
      return { cmd: 'clip', args: [] };
    default:
      // Linux/BSD: prefer wl-copy (Wayland) or xclip (X11); caller falls back if absent.
      return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
  }
}

/** Copy text to the system clipboard. Returns true on success, false if no tool is available. */
export function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform): boolean {
  const c = clipboardCommand(platform);
  if (!c) return false;
  try {
    const res = spawnSync(c.cmd, c.args, { input: text });
    return res.status === 0;
  } catch {
    return false;
  }
}
