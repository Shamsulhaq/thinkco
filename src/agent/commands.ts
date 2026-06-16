/** Slash command framework. Built-ins live here; Phase 8 adds custom markdown commands. */

export interface CommandContext {
  /** Raw argument string after the command name. */
  args: string;
  /** Mutable session-ish state the command may read/modify. */
  state: CommandState;
}

export interface CommandState {
  provider: string;
  model: string;
  /** Set to true to clear the conversation. */
  clear?: boolean;
  /** Set to true to exit the REPL. */
  exit?: boolean;
}

export interface CommandResult {
  /** Message to display to the user. */
  message?: string;
  /** If set, the frontend runs an agent turn with this prompt. */
  prompt?: string;
  /** Whether the command was handled (vs. unknown). */
  handled: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  run(ctx: CommandContext): CommandResult | Promise<CommandResult>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, SlashCommand>();

  register(cmd: SlashCommand): void {
    this.commands.set(cmd.name, cmd);
  }

  list(): SlashCommand[] {
    return [...this.commands.values()];
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  /** Returns true if input is a slash command. */
  static isCommand(input: string): boolean {
    return input.trimStart().startsWith('/');
  }

  async dispatch(input: string, state: CommandState): Promise<CommandResult> {
    const trimmed = input.trimStart().slice(1);
    const spaceIdx = trimmed.indexOf(' ');
    const name = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).trim();
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
    const cmd = this.commands.get(name);
    if (!cmd) {
      return { handled: false, message: `Unknown command: /${name}` };
    }
    return cmd.run({ args, state });
  }
}

/** Build the default built-in commands. */
export function builtinCommands(): SlashCommand[] {
  return [
    {
      name: 'help',
      description: 'Show available commands',
      run: () => ({
        handled: true,
        message: [
          '/help               Show this help',
          '/clear              Clear the conversation',
          '/compact [focus]    Summarize older messages to free context',
          '/resume             Resume a previous session (picker)',
          '/models             Pick a model (↑/↓ arrows)',
          '/login              Add a provider API key or custom provider',
          '/mode               Permission mode (or Shift+Tab to cycle)',
          '/agent              Switch primary agent: build|plan|compose (or Tab to cycle)',
          '/goal               Set a stop condition verified by a judge model',
          '/compose            Specs-driven orchestration: /compose <spec>',
          '/agents             List/cancel sub-agents',
          '/budget             Per-session cost cap',
          '/undo               Revert the working tree to the pre-turn snapshot (autoCommit)',
          '/provider <name>    Switch provider',
          '/skills             List available skills',
          '/plugin             List installed plugins',
          '/usage              Show token usage and cost',
          '/trust              Auto-approve basic actions in this folder',
          '/init               Generate a starter AGENT.md',
          '/doctor             Diagnose config/providers/MCP/skills',
          '/config             Show effective configuration',
          '/rename <name>      Name the current session',
          '/exit               Quit',
          '',
          'Tips: @file to attach a file · Tab to autocomplete commands · skills auto-activate.',
        ].join('\n'),
      }),
    },
    {
      name: 'clear',
      description: 'Clear the conversation',
      run: (ctx) => {
        ctx.state.clear = true;
        return { handled: true, message: 'Conversation cleared.' };
      },
    },
    {
      name: 'provider',
      description: 'Switch provider',
      run: (ctx) => {
        if (!ctx.args) return { handled: true, message: `Current provider: ${ctx.state.provider}` };
        ctx.state.provider = ctx.args;
        return { handled: true, message: `Provider set to ${ctx.args}.` };
      },
    },
    {
      name: 'exit',
      description: 'Quit',
      run: (ctx) => {
        ctx.state.exit = true;
        return { handled: true, message: 'Bye.' };
      },
    },
  ];
}
