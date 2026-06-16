/** Usage tracking: aggregate token usage across a session for a /usage dashboard. */
import type { Usage } from '../types/index.js';
import { lookupPrice, type PricingData } from './pricing.js';

export class UsageTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private turns = 0;
  /** Dynamic pricing (from models.dev), set once loaded. */
  private pricing?: PricingData;

  add(usage: Usage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.turns += 1;
  }

  /** Provide dynamic pricing data (fetched from models.dev). */
  setPricing(pricing: PricingData): void {
    this.pricing = pricing;
  }

  totals(): { inputTokens: number; outputTokens: number; turns: number } {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens, turns: this.turns };
  }

  /** Estimated USD cost from live pricing (per 1M tokens). 0 if the model price is unknown. */
  estimateCost(model: string, provider?: string): number {
    if (!this.pricing) return 0;
    const price = lookupPrice(this.pricing, model, provider);
    if (!price) return 0;
    return (this.inputTokens / 1_000_000) * price.inputPer1M + (this.outputTokens / 1_000_000) * price.outputPer1M;
  }

  format(model: string, provider?: string): string {
    const cost = this.estimateCost(model, provider);
    const costStr = cost > 0 ? ` ~$${cost.toFixed(4)}` : '';
    return `Usage: ${this.turns} turn(s), in ${this.inputTokens} / out ${this.outputTokens} tokens${costStr}`;
  }
}
