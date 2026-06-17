/** Extended built-in commands: /compact, /resume, /init, /doctor, /config, /rename. */
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SlashCommand, CommandState } from '../agent/commands.js';
import type { Message } from '../types/index.js';
import type { Config } from '../config/index.js';
import type { SessionStore, Session } from '../agent/session.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { SkillRegistry } from '../skills/registry.js';
import { compactConversation, providerSummarizer } from '../context/budget.js';
import { walkFiles } from '../tools/glob.js';
import { VERSION } from '../index.js';

/** Transport-agnostic selection prompt (readline picker, Ink overlay, …). */
export type SelectFn = (title: string, items: string[], current: number) => Promise<string | null>;

export interface BuiltinDeps {
  cwd: string;
  config: Config;
  state: CommandState;
  getMessages: () => Message[];
  setMessages: (m: Message[]) => void;
  sessionStore: SessionStore;
  getSession: () => Session;
  setSession: (s: Session) => void;
  providerRegistry: ProviderRegistry;
  tools: ToolRegistry;
  skills: SkillRegistry;
  getMode: () => string;
  select?: SelectFn;
}

export function extendedCommands(deps: BuiltinDeps): SlashCommand[] {
  return [
    compactCommand(deps),
    resumeCommand(deps),
    initCommand(deps),
    doctorCommand(deps),
    configCommand(deps),
    renameCommand(deps),
  ];
}

function compactCommand(deps: BuiltinDeps): SlashCommand {
  return {
    name: 'compact',
    description: 'Summarize older messages to free context (/compact [focus])',
    run: async (ctx) => {
      const before = deps.getMessages().length;
      let summarize: ((m: Message[]) => Promise<string>) | undefined;
      try {
        const provider = deps.providerRegistry.create(deps.state.provider, deps.config);
        summarize = providerSummarizer(provider, deps.state.model);
      } catch {
        summarize = undefined; // heuristic fallback
      }
      const focus = ctx.args ? `Focus on: ${ctx.args}. ` : '';
      const { messages, compacted } = await compactConversation(deps.getMessages(), {
        maxTokens: 0, // force compaction
        keepRecent: 4,
        summarize: summarize ? async (m) => `${focus}${await summarize!(m)}` : undefined,
      });
      if (!compacted) return { handled: true, message: 'Nothing to compact yet.' };
      deps.setMessages(messages);
      const s = deps.getSession();
      s.messages = [...messages];
      deps.sessionStore.save(s);
      return { handled: true, message: `Compacted ${before} → ${messages.length} messages.` };
    },
  };
}

function resumeCommand(deps: BuiltinDeps): SlashCommand {
  return {
    name: 'resume',
    description: 'Resume a previous session (arrow picker)',
    run: async () => {
      const sessions = deps.sessionStore.list();
      if (!sessions.length) return { handled: true, message: 'No saved sessions.' };
      const labels = sessions.map((s) => `${s.id}  (${s.updatedAt})`);
      if (!process.stdin.isTTY || !deps.select) {
        return { handled: true, message: `Sessions:\n${labels.join('\n')}\nUse --resume <id>.` };
      }
      const picked = await deps.select('Resume session', labels, 0);
      if (!picked) return { handled: true, message: 'Cancelled.' };
      const id = picked.split(/\s+/)[0]!;
      const sess = deps.sessionStore.load(id);
      if (!sess) return { handled: true, message: `Session ${id} not found.` };
      deps.setSession(sess);
      deps.setMessages(sess.messages);
      return { handled: true, message: `Resumed ${sess.name ?? id} (${sess.messages.length} messages).` };
    },
  };
}

function initCommand(deps: BuiltinDeps): SlashCommand {
  return {
    name: 'init',
    description: 'Generate a starter AGENT.md by scanning the project',
    run: () => {
      const path = join(deps.cwd, 'AGENT.md');
      if (existsSync(path)) return { handled: true, message: 'AGENT.md already exists — leaving it untouched.' };
      let projectName = deps.cwd.split('/').pop() ?? 'project';
      let scripts: string[] = [];
      try {
        const pkg = JSON.parse(readFileSync(join(deps.cwd, 'package.json'), 'utf8')) as {
          name?: string;
          scripts?: Record<string, string>;
        };
        if (pkg.name) projectName = pkg.name;
        if (pkg.scripts) scripts = Object.keys(pkg.scripts);
      } catch {
        // no package.json
      }
      const files = walkFiles({ root: deps.cwd, limit: 40 });
      const content = `# AGENT.md — ${projectName}

> Context for AI coding agents working in this repo. Edit freely.

## Overview

(Describe what ${projectName} is and its architecture.)

## Build & test

${scripts.length ? scripts.map((s) => `- \`npm run ${s}\``).join('\n') : '- (add build/test commands)'}

## Conventions

- (coding style, libraries, patterns)

## Notable files

${files.slice(0, 20).map((f) => `- ${f}`).join('\n')}
`;
      writeFileSync(path, content);
      return { handled: true, message: `Created AGENT.md for ${projectName}.` };
    },
  };
}

function doctorCommand(deps: BuiltinDeps): SlashCommand {
  return {
    name: 'doctor',
    description: 'Diagnose configuration, providers, MCP, skills, and permissions',
    run: () => {
      const cfg = deps.config;
      const providerKey =
        deps.state.provider === 'ollama' || deps.state.provider === 'lmstudio' || deps.state.provider === 'fake'
          ? 'n/a (local/offline)'
          : cfg.providers[deps.state.provider]?.apiKey
            ? 'set'
            : 'MISSING';
      const lines = [
        `ok    thinkco v${VERSION} · node ${process.version}`,
        `${providerKey === 'MISSING' ? 'error' : 'ok'} provider: ${deps.state.provider} (api key: ${providerKey})`,
        `ok    model: ${deps.state.model}`,
        `ok    mode: ${deps.getMode()}`,
        `ok    tools: ${deps.tools.list().length}`,
        `ok    skills: ${deps.skills.list().length}`,
        `${Object.keys(cfg.mcpServers).length ? 'ok' : 'warn'}  mcpServers: ${Object.keys(cfg.mcpServers).length || 0}`,
        `${cfg.permissions.sandbox ? 'ok' : 'warn'}  permissions: allow=${cfg.permissions.allow.length} deny=${cfg.permissions.deny.length} sandbox=${cfg.permissions.sandbox}`,
        `ok    cwd: ${deps.cwd}`,
        '',
        providerKey === 'MISSING' ? 'fix   run /login or set the provider API key in config.' : 'fix   run /provider status or /models refresh if model calls fail.',
        cfg.permissions.sandbox ? 'fix   sandbox is enabled.' : 'fix   consider enabling permissions.sandbox for stronger shell safety.',
      ];
      return { handled: true, message: lines.join('\n') };
    },
  };
}

function configCommand(deps: BuiltinDeps): SlashCommand {
  return {
    name: 'config',
    description: 'Show effective configuration and where it is stored',
    run: () => {
      const cfg = deps.config;
      const lines = [
        `provider:     ${deps.state.provider}`,
        `model:        ${deps.state.model}`,
        `mode:         ${deps.getMode()}`,
        `logLevel:     ${cfg.logLevel}`,
        `allow:        ${cfg.permissions.allow.join(', ') || '(none)'}`,
        `deny:         ${cfg.permissions.deny.join(', ') || '(none)'}`,
        '',
        'Global config: ~/.config/thinkco/config.json',
        'Project config: ./.thinkco/config.json',
        'Change model with /models · permission mode with /mode.',
      ];
      return { handled: true, message: lines.join('\n') };
    },
  };
}

function renameCommand(deps: BuiltinDeps): SlashCommand {
  return {
    name: 'rename',
    description: 'Name the current session (/rename <name>)',
    run: (ctx) => {
      const s = deps.getSession();
      if (!ctx.args) return { handled: true, message: `Current session: ${s.name ?? s.id}` };
      s.name = ctx.args;
      deps.sessionStore.save(s);
      return { handled: true, message: `Session renamed to "${ctx.args}".` };
    },
  };
}
