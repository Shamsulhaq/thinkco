import { describe, it, expect } from 'vitest';
import { searchRegistry, resolveInstallSource, type RegistryEntry } from '../src/plugins/registry.js';
import { parseInterval, Scheduler, type ScheduleEntry } from '../src/workflows/schedule.js';

const REG: RegistryEntry[] = [
  { name: 'code-review', description: 'review code', url: 'https://x/cr' },
  { name: 'commits', description: 'conventional commits', url: 'https://x/cc' },
];

describe('plugin registry', () => {
  it('searches by name and description', () => {
    expect(searchRegistry('review', REG).map((e) => e.name)).toEqual(['code-review']);
    expect(searchRegistry('conventional', REG).map((e) => e.name)).toEqual(['commits']);
    expect(searchRegistry('', REG).length).toBe(2);
  });

  it('resolves a registry name with no bundled copy to its URL', () => {
    // "commits" has no bundled plugin dir, so it falls back to the registry URL.
    expect(resolveInstallSource('commits', REG)).toBe('https://x/cc');
  });

  it('passes through git URLs and paths unchanged', () => {
    expect(resolveInstallSource('https://github.com/a/b', REG)).toBe('https://github.com/a/b');
    expect(resolveInstallSource('./local/plugin', REG)).toBe('./local/plugin');
  });

  it('throws on an unknown name', () => {
    expect(() => resolveInstallSource('nope', REG)).toThrow(/Unknown plugin/);
  });
});

describe('schedule', () => {
  it('parses intervals', () => {
    expect(parseInterval('30s')).toBe(30_000);
    expect(parseInterval('15m')).toBe(900_000);
    expect(parseInterval('2h')).toBe(7_200_000);
    expect(parseInterval('1d')).toBe(86_400_000);
    expect(parseInterval('bad')).toBeNull();
  });

  it('runs tasks only when due, with an injected clock', async () => {
    let t = 1_000_000;
    const entries: ScheduleEntry[] = [{ id: 'a', every: '1m', prompt: 'do a' }];
    const sch = new Scheduler(entries, { now: () => t });
    const ran: string[][] = [];
    const runner = async (p: string) => {
      ran.push(['ran', p]);
    };

    // Not due yet.
    expect(await sch.tick(runner)).toEqual([]);
    // Advance 61s → due.
    t += 61_000;
    expect(await sch.tick(runner)).toEqual(['a']);
    // Immediately after → not due again.
    expect(await sch.tick(runner)).toEqual([]);
    expect(ran.length).toBe(1);
  });

  it('skips invalid intervals', () => {
    const sch = new Scheduler([{ id: 'x', every: 'nonsense', prompt: 'p' }]);
    expect(sch.size).toBe(0);
  });

  it('a failing task does not stop the scheduler', async () => {
    let t = 0;
    const sch = new Scheduler([{ id: 'a', every: '1s', prompt: 'p' }], { now: () => t });
    t += 2000;
    const ran = await sch.tick(async () => {
      throw new Error('boom');
    });
    expect(ran).toEqual(['a']); // it ran (and the error was swallowed)
  });
});
