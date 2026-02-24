import crypto from "crypto";
import { z } from "zod";

const InputSchema = z
  .object({
    objective: z.string(),
    text: z.string().optional(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

interface RiskFactor {
  factor: string;
  score: number;
  weight: number;
  description: string;
}

function assessRisk(
  objective: string,
  text?: string,
  context?: Record<string, unknown>
) {
  const content = `${objective} ${text || ""}`.toLowerCase();
  const riskFactors: RiskFactor[] = [];

  // Complexity risk
  const complexityKeywords = ["complex", "large-scale", "enterprise", "migration", "transformation", "overhaul"];
  const complexityHits = complexityKeywords.filter((k) => content.includes(k)).length;
  const complexityScore = Math.min(20 + complexityHits * 15, 80);
  riskFactors.push({
    factor: "Complexity",
    score: complexityScore,
    weight: 0.25,
    description: `Project complexity assessed based on scope indicators (${complexityHits} complexity factors detected)`,
  });

  // Technical risk
  const techKeywords = ["new technology", "unproven", "experimental", "custom", "legacy", "integration"];
  const techHits = techKeywords.filter((k) => content.includes(k)).length;
  const techScore = Math.min(15 + techHits * 18, 85);
  riskFactors.push({
    factor: "Technical",
    score: techScore,
    weight: 0.2,
    description: `Technical risk from technology choices and integration challenges (${techHits} technical risk indicators)`,
  });

  // Timeline risk
  const timeKeywords = ["urgent", "deadline", "accelerated", "fast-track", "immediate", "rush"];
  const timeHits = timeKeywords.filter((k) => content.includes(k)).length;
  const timeScore = Math.min(20 + timeHits * 20, 90);
  riskFactors.push({
    factor: "Timeline",
    score: timeScore,
    weight: 0.2,
    description: `Timeline pressure and scheduling risk (${timeHits} urgency indicators)`,
  });

  // Resource risk
  const resourceKeywords = ["limited", "constrained", "shortage", "scarce", "understaffed"];
  const resourceHits = resourceKeywords.filter((k) => content.includes(k)).length;
  const resourceScore = Math.min(15 + resourceHits * 20, 80);
  riskFactors.push({
    factor: "Resource",
    score: resourceScore,
    weight: 0.15,
    description: `Resource availability and allocation risk (${resourceHits} constraint indicators)`,
  });

  // External dependency risk
  const extKeywords = ["vendor", "third-party", "external", "partner", "regulatory", "compliance"];
  const extHits = extKeywords.filter((k) => content.includes(k)).length;
  const extScore = Math.min(10 + extHits * 15, 75);
  riskFactors.push({
    factor: "External Dependencies",
    score: extScore,
    weight: 0.2,
    description: `Risk from external dependencies and regulatory requirements (${extHits} external factors)`,
  });

  // Calculate weighted overall score
  const overallRiskScore = Math.round(
    riskFactors.reduce((sum, f) => sum + f.score * f.weight, 0)
  );

  // Determine risk level
  let riskLevel: "low" | "medium" | "high" | "critical";
  if (overallRiskScore <= 25) riskLevel = "low";
  else if (overallRiskScore <= 50) riskLevel = "medium";
  else if (overallRiskScore <= 75) riskLevel = "high";
  else riskLevel = "critical";

  // Generate mitigations
  const mitigations: string[] = [];

  if (complexityScore > 40)
    mitigations.push("Break objective into smaller, manageable phases to reduce complexity");
  if (techScore > 40)
    mitigations.push("Conduct technical proof-of-concept before full commitment");
  if (timeScore > 40)
    mitigations.push("Establish realistic timeline with buffer for contingencies");
  if (resourceScore > 40)
    mitigations.push("Secure resource commitments early and identify backup options");
  if (extScore > 40)
    mitigations.push("Map external dependencies and establish contingency plans");

  // Default mitigations
  mitigations.push("Implement regular risk review checkpoints");
  mitigations.push("Maintain stakeholder communication throughout execution");

  // Confidence based on input richness
  let confidence = 0.75;
  if (text) confidence += 0.05;
  if (context) confidence += 0.05;
  if (objective.length > 50) confidence += 0.05;
  confidence = Math.min(confidence, 0.95);

  return { overallRiskScore, riskLevel, riskFactors, mitigations, confidence };
}

export async function handleRiskScore(
  body: Record<string, unknown>,
  traceId?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);
  const result = assessRisk(parsed.objective, parsed.text, parsed.context);

  return {
    risk_id: crypto.randomUUID(),
    objective: parsed.objective,
    overall_risk_score: result.overallRiskScore,
    risk_level: result.riskLevel,
    risk_factors: result.riskFactors,
    mitigations: result.mitigations,
    confidence: result.confidence,
  };
}
