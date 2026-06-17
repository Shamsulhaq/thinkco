/** Compose orchestration: phase definitions and verify-gate command helpers. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/** The sequential compose phases (excluding the final readme phase). */
export function composePhases(spec: string): Array<[string, string]> {
  return [
    ['plan', `Restate the spec and assumptions, then create a task tree with the \`task\` tool (subtasks under a top task). Spec:\n${spec}`],
    ['docs', 'Write a `PRD.md` (Product Requirements Document) at the project root capturing the goals, scope, user stories/requirements, constraints, and acceptance criteria derived from the spec. If the work warrants it, also create supporting design docs (e.g. `ARCHITECTURE.md` or `DESIGN.md`). Use the write/edit tools.'],
    ['implement', 'Implement the planned tasks. Use the file/edit/shell tools; mark each task in_progress then done with the `task` tool as you complete it. Delegate self-contained chunks with the `subagent` tool when helpful.'],
    ['review', 'Critically review the changes so far for correctness, security, and clarity. Fix any issues you find.'],
    ['test', 'Add or update tests that meaningfully verify the new behavior, then run them.'],
    ['verify', 'Run the project build and full test suite. Fix failures until everything is green, then give a short final summary of what shipped and what was verified.'],
  ];
}

export const COMPOSE_README_INSTRUCTION =
  '[COMPOSE · README phase] Create or update `README.md` so it accurately documents what shipped: ' +
  'a short overview, key features, install/setup steps, usage/examples, and configuration. ' +
  'Keep it consistent with the actual code and with PRD.md. Use the write/edit tools.';

/** Commands the compose verify phase runs (config.verify, else auto-detected npm build/test). */
export function detectVerifyCommands(cwd: string, configVerify: string[]): string[] {
  if (configVerify.length) return configVerify;
  const pkgPath = join(cwd, 'package.json');
  const cmds: string[] = [];
  try {
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      if (pkg.scripts?.build) cmds.push('npm run build');
      if (pkg.scripts?.test) cmds.push('npm test');
    }
  } catch {
    /* no package.json or unreadable */
  }
  return cmds;
}

/** Run a single verify command, capturing success and combined output. */
export function execVerify(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.trim() };
  }
}
