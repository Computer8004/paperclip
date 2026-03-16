/**
 * OpenCode subscription cost tracking
 * 
 * OpenCode uses subscription-based pricing rather than per-token pricing:
 * - Codex 5.3: $20/month, 5-hour weekly limit
 * - Kimi K2.5: $40/month, 5-hour weekly limit
 * 
 * This module provides:
 * 1. Subscription metadata for cost events
 * 2. Usage tracking against subscription limits
 * 3. OpenCode API integration for fetching actual usage/limits
 */

export interface OpenCodeSubscriptionPlan {
  planId: string;
  planName: string;
  monthlyPriceCents: number;
  weeklyHoursLimit: number;
  provider: "codex" | "kimi" | "other";
}

export interface OpenCodeUsageData {
  hoursUsedThisWeek: number;
  hoursLimit: number;
  requestsMade: number;
  periodStart: Date;
  periodEnd: Date;
  plan: OpenCodeSubscriptionPlan;
}

// Known OpenCode subscription plans
export const OPENCODE_SUBSCRIPTION_PLANS: Record<string, OpenCodeSubscriptionPlan> = {
  "kimi-for-coding/k2p5": {
    planId: "kimi-k2p5",
    planName: "Kimi K2.5",
    monthlyPriceCents: 4000, // $40/month
    weeklyHoursLimit: 5,
    provider: "kimi",
  },
  "codex/codex-5.3": {
    planId: "codex-5.3",
    planName: "Codex 5.3",
    monthlyPriceCents: 2000, // $20/month
    weeklyHoursLimit: 5,
    provider: "codex",
  },
};

/**
 * Get subscription plan details for a given model
 */
export function getSubscriptionPlan(model: string): OpenCodeSubscriptionPlan | null {
  // Normalize model name
  const normalizedModel = model.toLowerCase().trim();
  
  // Check for exact match first
  if (OPENCODE_SUBSCRIPTION_PLANS[normalizedModel]) {
    return OPENCODE_SUBSCRIPTION_PLANS[normalizedModel];
  }
  
  // Check for partial matches
  if (normalizedModel.includes("kimi") && normalizedModel.includes("k2")) {
    return OPENCODE_SUBSCRIPTION_PLANS["kimi-for-coding/k2p5"];
  }
  if (normalizedModel.includes("codex")) {
    return OPENCODE_SUBSCRIPTION_PLANS["codex/codex-5.3"];
  }
  
  return null;
}

/**
 * Determine if a model uses subscription billing
 */
export function isSubscriptionModel(model: string): boolean {
  return getSubscriptionPlan(model) !== null;
}

/**
 * Get billing type for cost tracking
 */
export function getBillingType(model: string): "subscription" | "api" {
  return isSubscriptionModel(model) ? "subscription" : "api";
}

/**
 * Calculate effective cost for subscription usage
 * This represents the "cost" of usage against the subscription limit
 * rather than actual dollars spent
 */
export function calculateEffectiveCost(
  usage: { inputTokens: number; outputTokens: number; hoursUsed?: number },
  model: string
): { costCents: number; effectiveCostCents: number; billingType: "subscription" | "api" } {
  const plan = getSubscriptionPlan(model);
  
  if (!plan) {
    // Fall back to API pricing (shouldn't happen for OpenCode)
    return {
      costCents: 0,
      effectiveCostCents: 0,
      billingType: "api",
    };
  }
  
  // For subscriptions, actual cost is 0 (within limits)
  // But we track effective cost as proportion of subscription used
  const hoursUsed = usage.hoursUsed ?? estimateHoursFromTokens(usage.inputTokens + usage.outputTokens);
  const utilizationPercent = Math.min(hoursUsed / plan.weeklyHoursLimit, 1);
  const effectiveCostCents = Math.round(plan.monthlyPriceCents * utilizationPercent);
  
  return {
    costCents: 0, // No additional cost within subscription
    effectiveCostCents,
    billingType: "subscription",
  };
}

/**
 * Estimate hours used from token count
 * Rough heuristic: ~100k tokens per hour at typical usage rates
 */
function estimateHoursFromTokens(totalTokens: number): number {
  const tokensPerHour = 100000;
  return totalTokens / tokensPerHour;
}

/**
 * Fetch usage data from OpenCode CLI/API
 * This would integrate with opencode's internal usage reporting
 */
export async function fetchOpenCodeUsage(
  _command: string = "opencode"
): Promise<OpenCodeUsageData | null> {
  // TODO: Implement actual OpenCode CLI integration
  // opencode likely has commands like:
  // - opencode usage --format json
  // - opencode status
  // 
  // For now, return null to indicate "not implemented"
  // This would be populated when OpenCode exposes the API
  return null;
}

/**
 * Get subscription metadata for cost event storage
 */
export function getSubscriptionMetadata(model: string): Record<string, unknown> | null {
  const plan = getSubscriptionPlan(model);
  if (!plan) return null;
  
  return {
    planId: plan.planId,
    planName: plan.planName,
    monthlyPriceCents: plan.monthlyPriceCents,
    weeklyHoursLimit: plan.weeklyHoursLimit,
    provider: plan.provider,
  };
}
