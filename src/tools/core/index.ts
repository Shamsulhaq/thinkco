/** Core tool set + registration helper. */
import type { ToolRegistry } from '../registry.js';
import type { Tool } from '../types.js';
import { fileTools } from './files.js';
import { searchTools } from './search.js';
import { shellTool } from './shell.js';
import { gitTool } from './git.js';
import { webFetchTool } from './web.js';
import { useAwsTool } from './aws.js';
import { taskTool } from './task.js';
import { memoryTool } from './memory.js';
import { webSearchTool } from './search-web.js';
import { codeTool } from '../code/index.js';
import { knowledgeTool } from '../knowledge/index.js';

export { fileTools } from './files.js';
export { searchTools } from './search.js';
export { shellTool } from './shell.js';
export { gitTool } from './git.js';
export { webFetchTool, makeWebFetchTool } from './web.js';
export { useAwsTool } from './aws.js';
export { taskTool } from './task.js';
export { memoryTool } from './memory.js';
export { webSearchTool } from './search-web.js';
export { codeTool } from '../code/index.js';
export { knowledgeTool } from '../knowledge/index.js';

/** All built-in core tools. */
export function coreTools(): Tool<unknown>[] {
  return [
    ...fileTools,
    ...searchTools,
    shellTool,
    gitTool,
    webFetchTool,
    webSearchTool,
    useAwsTool,
    taskTool,
    memoryTool,
    codeTool,
    knowledgeTool,
  ] as Tool<unknown>[];
}

/** Register all core tools into a registry. */
export function registerCoreTools(registry: ToolRegistry): void {
  registry.registerAll(coreTools());
}
