/** Tiny dependency-free argv parser supporting flags, options, and positionals. */

export interface ParsedArgs {
  positionals: string[];
  flags: Set<string>;
  options: Map<string, string>;
}

/**
 * Parse argv. Recognizes:
 *  --key value | --key=value | --flag | -f
 * `booleanFlags` lists keys that take no value.
 */
export function parseArgs(argv: string[], booleanFlags: string[] = []): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string>();
  const boolSet = new Set(booleanFlags);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        options.set(body.slice(0, eq), body.slice(eq + 1));
      } else if (boolSet.has(body)) {
        flags.add(body);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          options.set(body, next);
          i++;
        } else {
          flags.add(body);
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      flags.add(arg.slice(1));
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags, options };
}
