/** Transcript command: /transcript [copy|<path>] — export or copy the conversation. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { SlashCommand } from '../commands.js';
import { formatTranscript } from '../../ui/transcript.js';
import { copyToClipboard } from '../../util/clipboard.js';
import type { CommandHost } from './host.js';

export function buildTranscriptCommand(host: CommandHost): SlashCommand {
  return {
    name: 'transcript',
    description: 'Export the conversation: /transcript [copy|<path>]',
    run: (ctx) => {
      const text = formatTranscript(host.getMessages());
      const arg = ctx.args.trim();

      if (arg === 'copy') {
        const ok = copyToClipboard(text);
        return {
          handled: true,
          message: ok ? 'Transcript copied to clipboard.' : 'No clipboard tool found — use /transcript <path> to save instead.',
        };
      }

      const rel = arg || join('.thinkco', 'transcripts', `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
      const path = isAbsolute(rel) ? rel : join(host.cwd, rel);
      try {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, text, 'utf8');
        return { handled: true, message: `Transcript saved to ${path}` };
      } catch (err) {
        return { handled: true, message: `Could not write transcript: ${(err as Error).message}` };
      }
    },
  };
}
