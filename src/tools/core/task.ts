/** Persistent, tree-shaped task tool (T1, T1.1, …) that survives across sessions. */
import { z } from 'zod';
import type { Tool, ToolContext } from '../types.js';
import { TaskStore } from '../../agent/tasks.js';

const schema = z.object({
  command: z
    .enum(['add', 'start', 'done', 'remove', 'list', 'progress', 'next', 'clear'])
    .describe('Operation on the persistent task tree'),
  description: z.string().optional().describe('Task description (add)'),
  parent: z.string().optional().describe('Parent task id for a subtask, e.g. "T1" (add)'),
  id: z.string().optional().describe('Task id, e.g. "T1.2" (start/done/remove/progress)'),
  note: z.string().optional().describe('Progress note to append (progress)'),
  depends_on: z.array(z.string()).optional().describe('Task ids that must finish first (add)'),
  priority: z.enum(['low', 'medium', 'high']).optional().describe('Task priority (add)'),
});

type TaskInput = z.infer<typeof schema>;

export const taskTool: Tool<TaskInput> = {
  name: 'task',
  description:
    'Track work as a persistent task tree (T1, T1.1, …) with dependencies and priorities; survives ' +
    'across sessions and is folded into checkpoints. Commands: add (description[, parent, depends_on, ' +
    'priority]), start <id>, done <id>, remove <id>, list, next (highest-priority unblocked task), ' +
    'progress <id> [note], clear.',
  risk: 'read', // task bookkeeping has no destructive side effects
  schema,
  run: async (input, ctx: ToolContext) => {
    const store = new TaskStore(ctx.cwd);
    switch (input.command) {
      case 'add': {
        if (!input.description) throw new Error('task add requires "description"');
        const t = store.add(input.description, input.parent, { dependsOn: input.depends_on, priority: input.priority });
        return `Added ${t.id}: ${t.description}\n\n${store.render()}`;
      }
      case 'next': {
        const t = store.next();
        return t ? `Next: ${t.id} — ${t.description}` : 'No actionable task (all done or blocked).';
      }
      case 'start': {
        if (!input.id) throw new Error('task start requires "id"');
        return store.setStatus(input.id, 'in_progress') ? `Started ${input.id}.\n\n${store.render()}` : `No task ${input.id}.`;
      }
      case 'done': {
        if (!input.id) throw new Error('task done requires "id"');
        return store.setStatus(input.id, 'done') ? `Completed ${input.id}.\n\n${store.render()}` : `No task ${input.id}.`;
      }
      case 'remove': {
        if (!input.id) throw new Error('task remove requires "id"');
        const n = store.remove(input.id);
        return n ? `Removed ${n} task(s).\n\n${store.render()}` : `No task ${input.id}.`;
      }
      case 'progress': {
        if (!input.id) throw new Error('task progress requires "id"');
        if (input.note) {
          if (!store.appendProgress(input.id, input.note)) return `No task ${input.id}.`;
          return `Logged progress for ${input.id}.`;
        }
        return store.progress(input.id) || `(no progress logged for ${input.id})`;
      }
      case 'clear':
        store.clear();
        return 'Cleared all tasks.';
      case 'list':
        return store.render();
    }
  },
};
