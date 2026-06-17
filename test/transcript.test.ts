import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatTranscript } from '../src/ui/transcript.js';
import { clipboardCommand } from '../src/util/clipboard.js';
import { buildTranscriptCommand } from '../src/agent/commands/transcript.js';
import type { CommandHost } from '../src/agent/commands/host.js';
import type { Message } from '../src/types/index.js';

const convo: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
  { role: 'tool', content: [{ type: 'tool_result', toolUseId: 't', content: 'ran ok' }] },
];

describe('transcript export', () => {
  it('renders a markdown transcript with role sections', () => {
    const md = formatTranscript(convo, 'My Session');
    expect(md).toContain('# My Session');
    expect(md).toContain('User');
    expect(md).toContain('hello');
    expect(md).toContain('Assistant');
    expect(md).toContain('hi there');
    expect(md).toContain('ran ok');
  });

  it('maps clipboard commands per platform', () => {
    expect(clipboardCommand('darwin')).toEqual({ cmd: 'pbcopy', args: [] });
    expect(clipboardCommand('win32')).toEqual({ cmd: 'clip', args: [] });
    expect(clipboardCommand('linux')?.cmd).toBe('xclip');
  });

  it('/transcript writes the conversation to a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-tr-'));
    const host = { cwd: dir, getMessages: () => convo } as unknown as CommandHost;
    const cmd = buildTranscriptCommand(host);
    const res = cmd.run({ args: 'out.md', state: { provider: 'x', model: 'y' } }) as { message: string };
    const path = join(dir, 'out.md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('hi there');
    expect(res.message).toContain('out.md');
  });
});
