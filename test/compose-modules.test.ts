import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composePhases, detectVerifyCommands, execVerify, COMPOSE_README_INSTRUCTION } from '../src/agent/compose/orchestrator.js';
import { buildJudgePrompt, parseJudgeVerdict } from '../src/agent/compose/judge.js';
import { buildCheckpointBody, buildCheckpointPrompt, buildSessionContextBlock } from '../src/context/checkpoint.js';

describe('compose orchestrator', () => {
  it('lists the six lifecycle phases with the spec embedded in plan', () => {
    const phases = composePhases('build a todo app');
    expect(phases.map((p) => p[0])).toEqual(['plan', 'docs', 'implement', 'review', 'test', 'verify']);
    expect(phases[0]![1]).toContain('build a todo app');
    expect(COMPOSE_README_INSTRUCTION).toContain('README.md');
  });

  it('detects npm build/test from package.json scripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinkco-verify-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', test: 'vitest' } }));
      expect(detectVerifyCommands(dir, [])).toEqual(['npm run build', 'npm test']);
      // explicit config overrides detection
      expect(detectVerifyCommands(dir, ['make check'])).toEqual(['make check']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('execVerify reports failure for a non-zero command', () => {
    const r = execVerify('exit 1', process.cwd());
    expect(r.ok).toBe(false);
  });
});

describe('goal judge', () => {
  it('builds a strict prompt and parses JSON verdicts', () => {
    const prompt = buildJudgePrompt('all tests pass', 'assistant: done', true);
    expect(prompt).toContain('all tests pass');
    expect(prompt).toContain('Output ONLY this JSON');

    expect(parseJudgeVerdict('{"satisfied": true, "reason": "green"}')).toEqual({ satisfied: true, reason: 'green' });
    expect(parseJudgeVerdict('No, the build is incomplete')?.satisfied).toBe(false);
    expect(parseJudgeVerdict('totally ambiguous text')).toBeUndefined();
  });
});

describe('checkpoint helpers', () => {
  it('builds a checkpoint prompt and body', () => {
    const prompt = buildCheckpointPrompt('ship it', 'T1 open', 'user: hi');
    expect(prompt).toContain('ship it');
    const body = buildCheckpointBody({
      provider: 'anthropic',
      model: 'claude',
      agent: 'build',
      goal: 'ship it',
      tasks: 'T1 open',
      summary: 'Intent: ship',
      transcript: 'user: hi',
    });
    expect(body).toContain('Provider/model: anthropic · claude · agent: build');
    expect(body).toContain('Intent: ship');
  });

  it('budgets the session context block by weight', () => {
    const block = buildSessionContextBlock([
      { title: 'Open tasks', body: 'task A', cap: 100, weight: 4 },
      { title: 'Notes', body: 'note B', cap: 100, weight: 1 },
    ]);
    expect(block).toContain('Session memory');
    expect(block.indexOf('Open tasks')).toBeLessThan(block.indexOf('Notes'));
    // empty sections produce no block
    expect(buildSessionContextBlock([{ title: 'X', body: '', cap: 10, weight: 1 }])).toBe('');
  });
});
