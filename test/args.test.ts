import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/args.js';

describe('parseArgs', () => {
  it('parses boolean flags', () => {
    const r = parseArgs(['--help', '--version'], ['help', 'version']);
    expect(r.flags.has('help')).toBe(true);
    expect(r.flags.has('version')).toBe(true);
  });

  it('parses --key value options', () => {
    const r = parseArgs(['--provider', 'openai', '--model', 'gpt-4o']);
    expect(r.options.get('provider')).toBe('openai');
    expect(r.options.get('model')).toBe('gpt-4o');
  });

  it('parses --key=value options', () => {
    const r = parseArgs(['--provider=anthropic']);
    expect(r.options.get('provider')).toBe('anthropic');
  });

  it('collects positionals', () => {
    const r = parseArgs(['hello', 'world']);
    expect(r.positionals).toEqual(['hello', 'world']);
  });

  it('treats listed booleanFlags as flags even with following token', () => {
    const r = parseArgs(['--json', 'next'], ['json']);
    expect(r.flags.has('json')).toBe(true);
    expect(r.positionals).toEqual(['next']);
  });

  it('parses short flags', () => {
    const r = parseArgs(['-p', 'do a task']);
    expect(r.flags.has('p')).toBe(true);
    expect(r.positionals).toEqual(['do a task']);
  });
});
