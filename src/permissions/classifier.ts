/** Provider-backed safety classifier for `auto` permission mode. */
import type { Message, ProviderAdapter } from '../types/index.js';
import type { ClassifierFn } from './engine.js';
import { describeCall } from './classify.js';

const SYSTEM = `You are a safety classifier for a coding agent. Decide whether a pending tool action is safe to run automatically.
Reply with exactly "ALLOW" or "DENY: <short reason>".
DENY anything irreversible, destructive, that exfiltrates data, deploys to production, modifies shared infrastructure, force-pushes, or runs code downloaded from the internet (curl | bash).
ALLOW local file edits in the working directory, reads, installing declared dependencies, and running tests.`;

/**
 * Build a classifier backed by a provider/model. It sends the pending action plus a short
 * risk summary and parses the model's ALLOW/DENY verdict. Conservative on parse failure (deny).
 */
export function makeProviderClassifier(provider: ProviderAdapter, model: string): ClassifierFn {
  return async (call, assessment) => {
    const summary = `${describeCall(call)} [risk=${assessment.risk}${assessment.destructive ? ' destructive' : ''}${assessment.protected ? ' protected' : ''}]`;
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: `Pending action: ${summary}\nVerdict?` }] },
    ];
    let out = '';
    try {
      for await (const evt of provider.chat(messages, [], { model, system: SYSTEM, maxTokens: 64 })) {
        if (evt.type === 'text') out += evt.text;
      }
    } catch {
      return { allow: false, reason: 'classifier unavailable' };
    }
    const text = out.trim();
    if (/^\s*allow\b/i.test(text)) return { allow: true };
    const m = text.match(/deny\s*:?\s*(.*)/i);
    return { allow: false, reason: m?.[1]?.trim() || 'blocked by classifier' };
  };
}
