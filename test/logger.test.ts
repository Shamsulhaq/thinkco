import { describe, it, expect } from 'vitest';
import { Logger } from '../src/util/logger.js';

describe('logger sink redirection', () => {
  it('routes output to a sink instead of stderr when set', () => {
    const log = new Logger('info');
    const lines: Array<[string, string]> = [];
    log.setSink((level, line) => lines.push([level, line]));
    log.warn('careful');
    log.error('boom');
    log.info('fyi');
    expect(lines).toEqual([
      ['warn', '[warn] careful'],
      ['error', '[error] boom'],
      ['info', '[info] fyi'],
    ]);
  });

  it('respects the level threshold and can restore stderr output', () => {
    const log = new Logger('warn');
    const lines: string[] = [];
    log.setSink((_l, line) => lines.push(line));
    log.info('dropped'); // below threshold
    log.warn('kept');
    expect(lines).toEqual(['[warn] kept']);
    log.setSink(undefined); // back to stderr — should not throw
    expect(() => log.warn('to stderr')).not.toThrow();
  });
});
