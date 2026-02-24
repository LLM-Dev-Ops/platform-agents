import crypto from "crypto";
import { z } from "zod";
import { callClaude, extractJson } from "../claude";
import { analyzeText, type TextAnalysis } from "../text-analysis";

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

interface RiskResult {
  overall_risk_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_factors: RiskFactor[];
  mitigations: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Claude-powered analysis
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert risk analyst. Analyze the given objective and produce a thorough, domain-specific risk assessment.

Return ONLY valid JSON (no markdown fences, no explanation) with this exact structure:
{
  "overall_risk_score": <number 0-100>,
  "risk_level": "low" | "medium" | "high" | "critical",
  "risk_factors": [
    {
      "factor": "<specific, domain-relevant risk factor name>",
      "score": <number 0-100>,
      "weight": <number 0.0-1.0>,
      "description": "<2-3 sentence justification derived from the objective>"
    }
  ],
  "mitigations": ["<specific, actionable mitigation>"],
  "confidence": <number 0.0-1.0>
}

Rules:
- Extract DOMAIN-SPECIFIC risk factors from the objective, not generic ones.
- Include 4-7 risk factors covering: technology risks (migration complexity, vendor lock-in, integration challenges), business risks (timeline, budget, regulatory compliance), and operational risks (team readiness, data migration, rollback strategy) as applicable.
- All factor weights must sum to 1.0.
- overall_risk_score must equal the weighted sum of factor scores (rounded).
- risk_level: <=25 "low", <=50 "medium", <=75 "high", >75 "critical".
- Provide 3-7 specific, actionable mitigations tied to the identified risks.
- confidence reflects how much information was available for assessment (0.5-0.95).
- Every description and mitigation must reference specifics from the objective.`;

async function analyzeWithClaude(
  objective: string,
  text: string | undefined,
  apiKey: string
): Promise<RiskResult> {
  const userMsg = text
    ? `Objective: ${objective}\n\nAdditional context:\n${text}`
    : `Objective: ${objective}`;
  const raw = await callClaude(apiKey, SYSTEM_PROMPT, userMsg);
  const parsed = extractJson<RiskResult>(raw);
  // Validate and clamp values
  parsed.overall_risk_score = clamp(Math.round(parsed.overall_risk_score), 0, 100);
  parsed.confidence = clamp(parsed.confidence, 0, 1);
  parsed.risk_level = riskLevelFromScore(parsed.overall_risk_score);
  for (const f of parsed.risk_factors) {
    f.score = clamp(Math.round(f.score), 0, 100);
    f.weight = clamp(f.weight, 0, 1);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Heuristic analysis (no API key)
// ---------------------------------------------------------------------------

function analyzeHeuristic(
  objective: string,
  text: string | undefined,
  context: Record<string, unknown> | undefined
): RiskResult {
  const content = `${objective} ${text || ""}`;
  const ta = analyzeText(content);
  const factors: RiskFactor[] = [];

  // Build domain-specific risk factors based on what was actually found
  if (ta.actionType === "migration") {
    factors.push(buildMigrationRisks(ta, objective));
  }
  if (ta.entities.length > 0) {
    factors.push(buildTechnologyRisks(ta));
  }
  if (ta.riskSignals.includes("tight timeline pressure") || ta.constraints.includes("timeline constraint")) {
    factors.push({
      factor: `Timeline pressure for ${ta.actionType}`,
      score: 65,
      weight: 0,
      description: `The objective indicates time-sensitive delivery. ${ta.actionType !== "general" ? `A ${ta.actionType} effort under time pressure increases risk of incomplete testing and rushed decision-making.` : "Rushed timelines increase risk of quality issues."}`,
    });
  }
  if (ta.riskSignals.includes("resource constraints") || ta.constraints.includes("resource limitation")) {
    factors.push({
      factor: "Resource and capacity risk",
      score: 60,
      weight: 0,
      description: `Resource constraints detected in the objective. Limited staffing or budget for "${truncate(objective, 60)}" may lead to bottlenecks and delivery risk.`,
    });
  }
  if (ta.riskSignals.includes("vendor/third-party dependency")) {
    factors.push({
      factor: `Third-party dependency risk`,
      score: 55,
      weight: 0,
      description: `The objective involves external vendor or partner dependencies. This introduces risks around vendor reliability, lock-in, and alignment with ${ta.entities.length > 0 ? ta.entities.join(", ") : "project"} requirements.`,
    });
  }
  if (ta.riskSignals.includes("regulatory/compliance exposure") || ta.constraints.includes("regulatory requirement")) {
    const complianceEntities = ta.entities.filter((e) =>
      /PCI|HIPAA|GDPR|SOC|SOX|CCPA|ISO|NIST|FedRAMP/i.test(e)
    );
    factors.push({
      factor: `Compliance risk${complianceEntities.length > 0 ? ` (${complianceEntities.join(", ")})` : ""}`,
      score: 60,
      weight: 0,
      description: `Regulatory or compliance requirements add constraints to the ${ta.actionType}. Non-compliance could result in legal liability, fines, or project delays.`,
    });
  }
  if (ta.riskSignals.includes("data integrity/migration risk")) {
    factors.push({
      factor: "Data integrity and migration risk",
      score: 65,
      weight: 0,
      description: `Data migration or transformation is involved. Risks include data loss, corruption, schema incompatibilities, and validation gaps during the transition.`,
    });
  }
  if (ta.riskSignals.includes("security exposure")) {
    factors.push({
      factor: "Security exposure risk",
      score: 55,
      weight: 0,
      description: `Security considerations are present in the objective. Changes to systems or infrastructure may introduce new attack surfaces or temporarily weaken security posture.`,
    });
  }
  if (ta.riskSignals.includes("technical complexity") && !factors.some((f) => f.factor.includes("complexity"))) {
    factors.push({
      factor: `Technical complexity of ${ta.actionType}`,
      score: 60,
      weight: 0,
      description: `The scope described in "${truncate(objective, 50)}" indicates significant technical complexity involving ${ta.entities.length > 0 ? ta.entities.slice(0, 3).join(", ") : "multiple systems"}.`,
    });
  }

  // Ensure we have at least 3 factors
  if (factors.length < 3) {
    if (!factors.some((f) => f.factor.toLowerCase().includes("scope"))) {
      factors.push({
        factor: `Scope management for ${ta.actionType || "initiative"}`,
        score: 40,
        weight: 0,
        description: `Without clearly bounded scope, "${truncate(objective, 50)}" risks expanding beyond original intent, impacting timelines and resources.`,
      });
    }
    if (factors.length < 3) {
      factors.push({
        factor: "Stakeholder alignment risk",
        score: 35,
        weight: 0,
        description: `Ensuring all stakeholders agree on approach, priorities, and success criteria for "${truncate(objective, 50)}" is critical for avoiding mid-project pivots.`,
      });
    }
    if (factors.length < 3) {
      factors.push({
        factor: "Execution and delivery risk",
        score: 40,
        weight: 0,
        description: `General execution risk for the described initiative. Unforeseen technical or organizational challenges may arise during implementation.`,
      });
    }
  }

  // Assign weights evenly then adjust
  const evenWeight = parseFloat((1.0 / factors.length).toFixed(3));
  for (const f of factors) f.weight = evenWeight;
  // Fix rounding: give remainder to first factor
  const remainder = parseFloat((1.0 - evenWeight * factors.length).toFixed(3));
  if (factors.length > 0) factors[0].weight = parseFloat((factors[0].weight + remainder).toFixed(3));

  // Calculate weighted score
  const overallRiskScore = clamp(
    Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0)),
    0,
    100
  );

  // Generate mitigations tied to the specific factors
  const mitigations = factors
    .filter((f) => f.score >= 40)
    .map((f) => generateMitigation(f, ta));
  if (mitigations.length < 2) {
    mitigations.push(
      `Establish regular risk review checkpoints throughout the ${ta.actionType} process`
    );
  }

  // Confidence based on input richness
  let confidence = 0.55;
  if (text) confidence += 0.1;
  if (context) confidence += 0.05;
  if (ta.wordCount > 20) confidence += 0.05;
  if (ta.wordCount > 50) confidence += 0.05;
  if (ta.entities.length > 0) confidence += 0.05;
  confidence = clamp(confidence, 0.4, 0.85);

  return {
    overall_risk_score: overallRiskScore,
    risk_level: riskLevelFromScore(overallRiskScore),
    risk_factors: factors,
    mitigations,
    confidence,
  };
}

function buildMigrationRisks(ta: TextAnalysis, objective: string): RiskFactor {
  const from = ta.entities.length > 0 ? ta.entities[0] : "source system";
  const to = ta.entities.length > 1 ? ta.entities[1] : "target system";
  return {
    factor: `Migration complexity (${from} to ${to})`,
    score: 65,
    weight: 0,
    description: `Migrating from ${from} to ${to} involves compatibility risks, data transfer challenges, and potential downtime. ${ta.constraints.length > 0 ? `Additional constraints: ${ta.constraints.join(", ")}.` : "Careful planning and rollback strategies are essential."}`,
  };
}

function buildTechnologyRisks(ta: TextAnalysis): RiskFactor {
  const techs = ta.entities.slice(0, 4).join(", ");
  return {
    factor: `Technology risk (${techs})`,
    score: ta.entities.length > 3 ? 60 : 45,
    weight: 0,
    description: `The objective involves ${techs}. ${ta.entities.length > 3 ? "Multiple technology dependencies increase integration complexity and potential for compatibility issues." : "Technology-specific risks include learning curve, ecosystem maturity, and vendor support."}`,
  };
}

function generateMitigation(factor: RiskFactor, ta: TextAnalysis): string {
  const name = factor.factor.toLowerCase();
  if (name.includes("migration"))
    return `Develop a detailed migration plan with rollback procedures, dry-run testing, and phased cutover for the ${ta.entities.slice(0, 2).join(" to ") || "system"} migration`;
  if (name.includes("timeline"))
    return `Build schedule buffers and define a minimum viable scope that can be delivered within the constrained timeline`;
  if (name.includes("resource"))
    return `Identify critical skill gaps early and secure dedicated team capacity before the ${ta.actionType} begins`;
  if (name.includes("compliance") || name.includes("regulatory"))
    return `Engage compliance/legal review early and build compliance checkpoints into the project plan`;
  if (name.includes("vendor") || name.includes("third-party"))
    return `Negotiate SLAs with vendors and identify alternative providers to reduce single-vendor dependency`;
  if (name.includes("data"))
    return `Implement data validation and reconciliation procedures at every stage of the data migration pipeline`;
  if (name.includes("security"))
    return `Conduct security review and threat modeling before and after system changes`;
  if (name.includes("technology"))
    return `Run a proof-of-concept or spike to validate technology choices (${ta.entities.slice(0, 2).join(", ")}) before committing to full implementation`;
  if (name.includes("scope"))
    return `Define clear scope boundaries and a formal change-request process to prevent scope creep`;
  return `Address ${factor.factor} through proactive monitoring, stakeholder communication, and contingency planning`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function riskLevelFromScore(score: number): "low" | "medium" | "high" | "critical" {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "critical";
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleRiskScore(
  body: Record<string, unknown>,
  traceId?: string,
  apiKey?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);

  let result: RiskResult;
  if (apiKey) {
    try {
      result = await analyzeWithClaude(parsed.objective, parsed.text, apiKey);
    } catch {
      // Fall back to heuristic on any Claude failure
      result = analyzeHeuristic(parsed.objective, parsed.text, parsed.context);
    }
  } else {
    result = analyzeHeuristic(parsed.objective, parsed.text, parsed.context);
  }

  return {
    risk_id: crypto.randomUUID(),
    objective: parsed.objective,
    overall_risk_score: result.overall_risk_score,
    risk_level: result.risk_level,
    risk_factors: result.risk_factors,
    mitigations: result.mitigations,
    confidence: result.confidence,
  };
}
