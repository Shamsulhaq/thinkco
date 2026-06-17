/** Goal judge: build the judge prompt and parse its verdict. */

export interface GoalVerdict {
  satisfied: boolean;
  reason: string;
}

/** Build the strict completion-judge prompt for a goal + recent transcript. */
export function buildJudgePrompt(goal: string, transcript: string, strict: boolean): string {
  return (
    `You are a STRICT completion judge. Goal:\n"${goal}"\n\n` +
    `Conversation:\n${transcript}\n\n` +
    `Has the goal been FULLY achieved (evidence in the conversation), not merely attempted or claimed? ` +
    (strict ? `Output ONLY this JSON and nothing else: ` : ``) +
    `{"satisfied": true|false, "reason": "<short>"}`
  );
}

/** Parse a judge model's free-text output into a verdict, or undefined if unparseable. */
export function parseJudgeVerdict(out: string): GoalVerdict | undefined {
  const m = out.match(/\{[\s\S]*?\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { satisfied?: unknown; reason?: unknown };
      return { satisfied: Boolean(j.satisfied), reason: String(j.reason ?? '') };
    } catch {
      /* fall through to heuristic */
    }
  }
  // Fallback: interpret a clear yes/no.
  if (/\b(not|isn'?t|incomplete|unmet|no)\b/i.test(out)) return { satisfied: false, reason: out.slice(0, 200) };
  return undefined;
}
