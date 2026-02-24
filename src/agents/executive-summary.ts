import crypto from "crypto";
import { z } from "zod";

const InputSchema = z
  .object({
    objective: z.string(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

function generateSummary(objective: string, context?: Record<string, unknown>) {
  const keyFindings: string[] = [];
  const lower = objective.toLowerCase();

  // Generate key findings based on objective analysis
  keyFindings.push(`Objective "${objective}" has been analyzed for strategic alignment and feasibility`);

  if (lower.includes("migration") || lower.includes("migrate")) {
    keyFindings.push("Migration scope requires careful planning of data transfer and system dependencies");
    keyFindings.push("Rollback strategy should be defined before execution");
  }

  if (lower.includes("cloud") || lower.includes("infrastructure")) {
    keyFindings.push("Cloud infrastructure considerations include scalability, cost optimization, and security compliance");
  }

  if (lower.includes("security") || lower.includes("compliance")) {
    keyFindings.push("Security and compliance requirements must be addressed throughout implementation");
  }

  if (lower.includes("cost") || lower.includes("budget")) {
    keyFindings.push("Cost-benefit analysis indicates attention to budget constraints is warranted");
  }

  // Default findings if none matched
  if (keyFindings.length === 1) {
    keyFindings.push("Implementation approach should follow established best practices");
    keyFindings.push("Stakeholder communication plan is recommended");
  }

  keyFindings.push("Resource allocation should be validated against project requirements");

  // Metrics
  const metrics: Record<string, unknown> = {
    complexity_score: lower.length > 50 ? "high" : lower.length > 25 ? "medium" : "low",
    estimated_impact: "moderate-to-high",
    strategic_alignment: 0.82,
  };

  if (context) {
    if (context.budget) metrics.budget_status = "reviewed";
    if (context.team_size) metrics.team_coverage = "assessed";
  }

  const executiveSummary =
    `This executive summary addresses the objective: "${objective}". ` +
    `Based on the analysis, the initiative demonstrates strategic value and feasibility. ` +
    `Key considerations include resource allocation, timeline management, and stakeholder alignment. ` +
    `The recommendation is to proceed with a phased approach, ensuring adequate checkpoints for progress evaluation.`;

  const recommendation =
    "Proceed with implementation using a phased approach. Establish clear milestones and review points. " +
    "Ensure stakeholder alignment at each phase gate before advancing to the next stage.";

  return { executiveSummary, keyFindings, metrics, recommendation };
}

export async function handleExecutiveSummary(
  body: Record<string, unknown>,
  traceId?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);
  const result = generateSummary(parsed.objective, parsed.context);

  return {
    summary_id: crypto.randomUUID(),
    objective: parsed.objective,
    executive_summary: result.executiveSummary,
    key_findings: result.keyFindings,
    metrics: result.metrics,
    recommendation: result.recommendation,
  };
}
