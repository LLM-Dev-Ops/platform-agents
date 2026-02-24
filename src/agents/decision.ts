import crypto from "crypto";
import { z } from "zod";

const InputSchema = z
  .object({
    objective: z.string(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

function analyzeObjective(objective: string, context?: Record<string, unknown>) {
  const lower = objective.toLowerCase();

  // Determine recommendation based on keyword analysis
  let recommendation: "proceed" | "hold" | "reject" = "proceed";
  let confidence = 0.85;
  const conditions: string[] = [];
  const risks: string[] = [];

  // Risk-related keywords lower confidence and may change recommendation
  const riskKeywords = ["risky", "uncertain", "experimental", "unproven", "volatile"];
  const holdKeywords = ["pending", "incomplete", "review", "evaluate", "assess"];
  const rejectKeywords = ["abandon", "cancel", "terminate", "infeasible"];
  const positiveKeywords = ["proven", "established", "standard", "optimize", "improve", "upgrade"];

  const hasRisk = riskKeywords.some((k) => lower.includes(k));
  const hasHold = holdKeywords.some((k) => lower.includes(k));
  const hasReject = rejectKeywords.some((k) => lower.includes(k));
  const hasPositive = positiveKeywords.some((k) => lower.includes(k));

  if (hasReject) {
    recommendation = "reject";
    confidence = 0.75;
    risks.push("Objective indicates termination or infeasibility");
  } else if (hasHold) {
    recommendation = "hold";
    confidence = 0.7;
    conditions.push("Requires further evaluation before proceeding");
  } else if (hasRisk) {
    recommendation = "hold";
    confidence = 0.65;
    risks.push("High uncertainty detected in objective");
    conditions.push("Risk mitigation plan required");
  }

  if (hasPositive) {
    confidence = Math.min(confidence + 0.1, 0.95);
  }

  // Standard conditions
  conditions.push("Stakeholder alignment confirmed");
  conditions.push("Resource availability verified");

  // Standard risks
  risks.push("Implementation timeline may vary");
  risks.push("Dependencies on external factors");

  // Context enrichment
  if (context) {
    if (context.budget) conditions.push("Budget allocation reviewed");
    if (context.timeline) conditions.push("Timeline constraints evaluated");
    if (context.stakeholders) conditions.push("Stakeholder input incorporated");
  }

  const reasoning = `Analysis of objective "${objective}" indicates a ${recommendation} recommendation with ${(confidence * 100).toFixed(0)}% confidence. ` +
    `${recommendation === "proceed" ? "The objective aligns with standard operational parameters and shows favorable indicators." : ""}` +
    `${recommendation === "hold" ? "Additional evaluation is recommended before committing resources." : ""}` +
    `${recommendation === "reject" ? "The objective presents significant concerns that warrant reconsideration." : ""}`;

  return { recommendation, confidence, reasoning, conditions, risks };
}

export async function handleDecision(
  body: Record<string, unknown>,
  traceId?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);
  const analysis = analyzeObjective(parsed.objective, parsed.context);

  return {
    decision_id: crypto.randomUUID(),
    objective: parsed.objective,
    recommendation: analysis.recommendation,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    conditions: analysis.conditions,
    risks: analysis.risks,
  };
}
