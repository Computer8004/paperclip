import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { costEvents, heartbeatRuns, agents } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { getSubscriptionPlan, type OpenCodeSubscriptionPlan } from "@paperclipai/adapter-opencode-local/server";

export interface AgentSubscriptionUsage {
  agentId: string;
  agentName: string;
  model: string;
  plan: OpenCodeSubscriptionPlan | null;
  weeklyHoursUsed: number;
  weeklyHoursLimit: number;
  utilizationPercent: number;
  runsThisWeek: number;
  inputTokens: number;
  outputTokens: number;
  periodStart: string;
  periodEnd: string;
}

export function opencodeUsageRoutes(db: Db) {
  const router = Router();

  // Get OpenCode subscription usage for all agents in a company
  router.get("/companies/:companyId/opencode-usage", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      // Get all opencode_local agents with their models
      const companyAgents = await db
        .select({
          id: agents.id,
          name: agents.name,
          adapterConfig: agents.adapterConfig,
        })
        .from(agents)
        .where(and(
          eq(agents.companyId, companyId),
          eq(agents.adapterType, "opencode_local")
        ));

      // Calculate period (current week)
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      weekStart.setHours(0, 0, 0, 0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // Get usage data for each agent
      const usageData: AgentSubscriptionUsage[] = [];

      for (const agent of companyAgents) {
        const model = (agent.adapterConfig as Record<string, unknown>)?.model as string || "";
        const plan = getSubscriptionPlan(model);

        // Get this week's runs for the agent
        const runs = await db
          .select({
            count: sql<number>`count(*)::int`,
            inputTokens: sql<number>`coalesce(sum(coalesce((${heartbeatRuns.usageJson} ->> 'inputTokens')::int, 0)), 0)::int`,
            outputTokens: sql<number>`coalesce(sum(coalesce((${heartbeatRuns.usageJson} ->> 'outputTokens')::int, 0)), 0)::int`,
          })
          .from(heartbeatRuns)
          .where(and(
            eq(heartbeatRuns.agentId, agent.id),
            eq(heartbeatRuns.companyId, companyId),
            gte(heartbeatRuns.finishedAt, weekStart)
          ));

        const runData = runs[0];
        
        // Estimate hours from tokens (rough heuristic)
        const totalTokens = runData.inputTokens + runData.outputTokens;
        const estimatedHours = totalTokens / 100000; // ~100k tokens/hour
        
        const weeklyHoursLimit = plan?.weeklyHoursLimit || 5;
        const utilizationPercent = weeklyHoursLimit > 0 
          ? Math.min((estimatedHours / weeklyHoursLimit) * 100, 100)
          : 0;

        usageData.push({
          agentId: agent.id,
          agentName: agent.name,
          model,
          plan,
          weeklyHoursUsed: Number(estimatedHours.toFixed(2)),
          weeklyHoursLimit,
          utilizationPercent: Number(utilizationPercent.toFixed(1)),
          runsThisWeek: runData.count || 0,
          inputTokens: runData.inputTokens || 0,
          outputTokens: runData.outputTokens || 0,
          periodStart: weekStart.toISOString(),
          periodEnd: weekEnd.toISOString(),
        });
      }

      res.json({
        period: {
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
        },
        agents: usageData,
        summary: {
          totalAgents: usageData.length,
          agentsNearLimit: usageData.filter(a => a.utilizationPercent >= 80).length,
          totalHoursUsed: Number(usageData.reduce((sum, a) => sum + a.weeklyHoursUsed, 0).toFixed(2)),
        },
      });
    } catch (error) {
      console.error("Error fetching OpenCode usage:", error);
      res.status(500).json({ 
        error: "Failed to fetch usage data",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get usage for a specific agent
  router.get("/agents/:agentId/opencode-usage", async (req, res) => {
    const agentId = req.params.agentId as string;

    try {
      const agent = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .then(rows => rows[0]);

      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      assertCompanyAccess(req, agent.companyId);

      if (agent.adapterType !== "opencode_local") {
        res.status(400).json({ error: "Agent is not an OpenCode agent" });
        return;
      }

      // Calculate period
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const model = (agent.adapterConfig as Record<string, unknown>)?.model as string || "";
      const plan = getSubscriptionPlan(model);

      // Get usage stats
      const runs = await db
        .select({
          count: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(coalesce((${heartbeatRuns.usageJson} ->> 'inputTokens')::int, 0)), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(coalesce((${heartbeatRuns.usageJson} ->> 'outputTokens')::int, 0)), 0)::int`,
        })
        .from(heartbeatRuns)
        .where(and(
          eq(heartbeatRuns.agentId, agentId),
          gte(heartbeatRuns.finishedAt, weekStart)
        ));

      const runData = runs[0];
      const totalTokens = runData.inputTokens + runData.outputTokens;
      const estimatedHours = totalTokens / 100000;
      const weeklyHoursLimit = plan?.weeklyHoursLimit || 5;
      const utilizationPercent = weeklyHoursLimit > 0 
        ? Math.min((estimatedHours / weeklyHoursLimit) * 100, 100)
        : 0;

      res.json({
        agentId: agent.id,
        agentName: agent.name,
        model,
        plan,
        weeklyHoursUsed: Number(estimatedHours.toFixed(2)),
        weeklyHoursLimit,
        utilizationPercent: Number(utilizationPercent.toFixed(1)),
        runsThisWeek: runData.count || 0,
        inputTokens: runData.inputTokens || 0,
        outputTokens: runData.outputTokens || 0,
        remainingHours: Number(Math.max(0, weeklyHoursLimit - estimatedHours).toFixed(2)),
      });
    } catch (error) {
      console.error("Error fetching agent usage:", error);
      res.status(500).json({ 
        error: "Failed to fetch usage data",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return router;
}
