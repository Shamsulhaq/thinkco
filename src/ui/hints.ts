/** Dynamic hint engine for the input box: a rotating pool of tips + a queue-aware busy hint. */

/** Shown in the input placeholder while a task is running (thinkco queues follow-up messages). */
export const QUEUE_HINT = 'type a message or /command to queue it for after this task…';

/** Idle tips, surfaced one at a time and rotated. All reference real thinkco features. */
export const HINTS: string[] = [
  'type a message or /command',
  'press Tab to switch agents — build · plan · compose',
  'Shift+Tab cycles permission modes (default · acceptEdits · plan · …)',
  'try /compose <spec> to build a feature end-to-end',
  '/goal <condition> lets a judge verify before thinkco stops',
  '@mention a file to include it in your message',
  '/login adds a provider · /models switches model',
  '/fallback openai:gpt-4o sets a backup when a provider fails',
  '/budget <usd> caps this session’s cost',
  '/undo reverts the last change (needs autoCommit)',
  '/skills lists skills — drop a SKILL.md to add your own',
  'run a shell command inline by starting a message with !',
  'press Ctrl+C twice to quit',
  '/resume <id> reopens a previous session',
];

/** Pick a random hint, optionally avoiding the current one so it visibly changes. */
export function randomHint(exclude?: string): string {
  const pool = exclude ? HINTS.filter((h) => h !== exclude) : HINTS;
  const list = pool.length ? pool : HINTS;
  return list[Math.floor(Math.random() * list.length)]!;
}
