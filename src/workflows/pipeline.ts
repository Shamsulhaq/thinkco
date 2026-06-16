/** Task pipelines: a DAG of stages, each run as a subagent, with dependency outputs as context. */

export interface PipelineStage {
  name: string;
  task: string;
  dependsOn?: string[];
}

export type StageRunner = (task: string, context: Record<string, string>) => Promise<string>;

/** Topologically order stages; throws on cycles or missing dependencies. */
export function topoSort(stages: PipelineStage[]): PipelineStage[] {
  const byName = new Map(stages.map((s) => [s.name, s]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const ordered: PipelineStage[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (inProgress.has(name)) throw new Error(`Cycle detected at stage "${name}"`);
    const stage = byName.get(name);
    if (!stage) throw new Error(`Unknown stage dependency "${name}"`);
    inProgress.add(name);
    for (const dep of stage.dependsOn ?? []) visit(dep);
    inProgress.delete(name);
    visited.add(name);
    ordered.push(stage);
  };

  for (const s of stages) visit(s.name);
  return ordered;
}

export interface PipelineResult {
  outputs: Record<string, string>;
  order: string[];
}

/** Run a pipeline: each stage receives its dependencies' outputs as context. */
export async function runPipeline(stages: PipelineStage[], runner: StageRunner): Promise<PipelineResult> {
  const ordered = topoSort(stages);
  const outputs: Record<string, string> = {};
  for (const stage of ordered) {
    const context: Record<string, string> = {};
    for (const dep of stage.dependsOn ?? []) context[dep] = outputs[dep] ?? '';
    outputs[stage.name] = await runner(stage.task, context);
  }
  return { outputs, order: ordered.map((s) => s.name) };
}
