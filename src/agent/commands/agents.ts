/** Agent orchestration commands: /agent, /goal, /compose, /agents. */
import type { SlashCommand } from '../commands.js';
import type { AgentName, CommandHost } from './host.js';
import { formatCrew } from '../../ui/crew.js';

export function buildAgentCommands(host: CommandHost): SlashCommand[] {
  return [
    {
      name: 'crew',
      description: 'Live crew monitor: status of all sub-agents this session',
      run: () => ({ handled: true, message: formatCrew(host.subagents) }),
    },
    {
      name: 'agent',
      description: 'Switch primary agent: /agent [build|plan|compose]',
      run: (ctx) => {
        const choice = ctx.args.trim() as AgentName;
        if (['build', 'plan', 'compose'].includes(choice)) {
          host.setAgent(choice);
          return { handled: true, message: `Agent: ${choice}` };
        }
        return {
          handled: true,
          message:
            `Current agent: ${host.getAgent()}\n` +
            '  build    full tool permissions for development\n' +
            '  plan     read-only analysis & solution design\n' +
            '  compose  specs-driven orchestration (plan→implement→review→test→verify)',
        };
      },
    },
    {
      name: 'goal',
      description: 'Set a stop condition judged by an independent model: /goal <condition> | clear',
      run: (ctx) => {
        const arg = ctx.args.trim();
        if (!arg) {
          const goal = host.getGoal();
          return { handled: true, message: goal ? `Goal: ${goal}` : 'No goal set. Use /goal <condition>.' };
        }
        if (arg === 'clear') {
          host.setGoal(undefined);
          return { handled: true, message: 'Goal cleared.' };
        }
        host.setGoal(arg);
        return { handled: true, message: `Goal set: ${arg}\nA judge model will verify it before the agent stops.` };
      },
    },
    {
      name: 'compose',
      description: 'Specs-driven orchestration: /compose <spec> (runs plan→implement→review→test→verify)',
      run: (ctx) => {
        host.setAgent('compose');
        const spec = ctx.args.trim();
        if (!spec) {
          return { handled: true, message: 'Switched to compose agent. Run /compose <spec> to orchestrate the full lifecycle.' };
        }
        host.setComposeSpec(spec); // handled by handleInput → runCompose (multi-phase)
        return { handled: true, message: `Composing: ${spec}` };
      },
    },
    {
      name: 'agents',
      description: 'List sub-agents and their status: /agents | /agents cancel <id>',
      run: (ctx) => {
        const [sub, id] = ctx.args.trim().split(/\s+/);
        const subagents = host.subagents;
        if (sub === 'cancel' && id) {
          const e = subagents.find((s) => s.id === id);
          if (!e) return { handled: true, message: `No subagent ${id}.` };
          if (e.status === 'running') {
            e.controller.abort();
            return { handled: true, message: `Cancelling ${id}…` };
          }
          return { handled: true, message: `${id} is already ${e.status}.` };
        }
        if (sub === 'result' && id) {
          const e = subagents.find((s) => s.id === id);
          if (!e) return { handled: true, message: `No subagent ${id}.` };
          if (e.status === 'running') return { handled: true, message: `${id} is still running.` };
          if (e.status === 'error') return { handled: true, message: `${id} failed: ${e.error}` };
          if (e.status === 'cancelled') return { handled: true, message: `${id} was cancelled.` };
          return { handled: true, message: e.result || `(${id} produced no output)` };
        }
        if (subagents.length === 0) return { handled: true, message: 'No sub-agents have run this session.' };
        return {
          handled: true,
          message:
            subagents.map((e) => `${e.id} [${e.status}] ${e.task.slice(0, 60)}`).join('\n') +
            '\n\n/agents result <id> · /agents cancel <id>',
        };
      },
    },
  ];
}
