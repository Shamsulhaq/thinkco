import { join } from 'node:path';
import { homedir } from 'node:os';

export * from './parse.js';
export * from './registry.js';

/** Default skill discovery roots: project then global. */
export function defaultSkillRoots(cwd: string): string[] {
  return [join(cwd, '.thinkco', 'skills'), join(homedir(), '.config', 'thinkco', 'skills')];
}
