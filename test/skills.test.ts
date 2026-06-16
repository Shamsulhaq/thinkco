import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, parseSkill, discoverSkills } from '../src/skills/parse.js';
import { SkillRegistry, skillScriptTool } from '../src/skills/registry.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thinkco-skills-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeSkill(name: string, frontmatter: string, body: string, extraFiles: Record<string, string> = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  for (const [file, content] of Object.entries(extraFiles)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

describe('frontmatter parsing', () => {
  it('parses keys and body', () => {
    const { meta, body } = parseFrontmatter('---\nname: x\ndescription: hello\n---\nBODY HERE');
    expect(meta.name).toBe('x');
    expect(meta.description).toBe('hello');
    expect(body).toBe('BODY HERE');
  });

  it('returns body unchanged with no frontmatter', () => {
    const { meta, body } = parseFrontmatter('just text');
    expect(meta).toEqual({});
    expect(body).toBe('just text');
  });
});

describe('skill discovery', () => {
  it('parses a skill with triggers and scripts', () => {
    const dir = makeSkill(
      'react-component',
      'name: react-component\ndescription: Create React components\ntriggers: react, component, jsx',
      'Steps to create a component...',
      { 'gen.sh': '#!/bin/sh\necho generated' },
    );
    const skill = parseSkill(dir);
    expect(skill?.name).toBe('react-component');
    expect(skill?.triggers).toEqual(['react', 'component', 'jsx']);
    expect(skill?.scripts).toContain('gen.sh');
  });

  it('discovers multiple skills', () => {
    makeSkill('a', 'name: a\ndescription: A\ntriggers: alpha', 'body a');
    makeSkill('b', 'name: b\ndescription: B\ntriggers: beta', 'body b');
    const skills = discoverSkills([root]);
    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });
});

describe('progressive loading', () => {
  it('catalog lists all skills', () => {
    const reg = new SkillRegistry([
      { name: 'x', description: 'desc', triggers: ['foo'], body: 'B', dir: '/x', scripts: [], allowedTools: [], paths: [], contextFork: false },
    ]);
    expect(reg.catalog()).toContain('x: desc');
  });

  it('activates only skills matching the query', () => {
    const reg = new SkillRegistry([
      { name: 'react', description: '', triggers: ['react', 'jsx'], body: 'RB', dir: '/r', scripts: [], allowedTools: [], paths: [], contextFork: false },
      { name: 'python', description: '', triggers: ['python', 'pip'], body: 'PB', dir: '/p', scripts: [], allowedTools: [], paths: [], contextFork: false },
    ]);
    const activated = reg.activate('help me build a react component');
    expect(activated.map((s) => s.name)).toEqual(['react']);
  });

  it('promptFor includes catalog and activated body', () => {
    const reg = new SkillRegistry([
      { name: 'react', description: 'd', triggers: ['react'], body: 'FULL_BODY', dir: '/r', scripts: [], allowedTools: [], paths: [], contextFork: false },
    ]);
    const prompt = reg.promptFor('do react things');
    expect(prompt).toContain('react: d');
    expect(prompt).toContain('FULL_BODY');
  });
});

describe('skill script tool', () => {
  it('runs a shell script and captures output', async () => {
    const dir = makeSkill('runner', 'name: runner\ndescription: r', 'body', {
      'go.sh': '#!/bin/sh\necho hello-from-skill',
    });
    const skill = parseSkill(dir)!;
    chmodSync(join(dir, 'go.sh'), 0o755);
    const tool = skillScriptTool(skill, 'go.sh');
    const out = await tool.run({}, { cwd: dir });
    expect(out).toContain('hello-from-skill');
    expect(tool.name).toBe('skill__runner__go_sh');
  });
});


describe('Agent Skills standard parity', () => {
  it('parses allowed-tools, paths, model, context:fork, agent', () => {
    const dir = makeSkill(
      'pr',
      'name: pr\ndescription: PR review\ntriggers: pr\nallowed-tools: git, shell\npaths: src/**/*.ts\nmodel: gpt-4o\ncontext: fork\nagent: Explore',
      'body',
    );
    const skill = parseSkill(dir)!;
    expect(skill.allowedTools).toEqual(['git', 'shell']);
    expect(skill.paths).toEqual(['src/**/*.ts']);
    expect(skill.model).toBe('gpt-4o');
    expect(skill.contextFork).toBe(true);
    expect(skill.agent).toBe('Explore');
  });

  it('path-gated skills activate only when a matching file is referenced', () => {
    const reg = new SkillRegistry([
      { name: 'ts', description: '', triggers: [], body: 'B', dir: '/t', scripts: [], allowedTools: [], paths: ['src/**/*.ts'], contextFork: false },
    ]);
    expect(reg.activate('do something generic').length).toBe(0);
    expect(reg.activate('look at src/app.ts please').length).toBe(1);
  });

  it('activeAllowedTools collects allowed-tools from activated skills', () => {
    const reg = new SkillRegistry([
      { name: 'committer', description: '', triggers: ['commit'], body: 'B', dir: '/c', scripts: [], allowedTools: ['git'], paths: [], contextFork: false },
    ]);
    expect(reg.activeAllowedTools('make a commit')).toEqual(['git']);
    expect(reg.activeAllowedTools('unrelated')).toEqual([]);
  });
});
