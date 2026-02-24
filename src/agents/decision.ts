import crypto from "crypto";
import { z } from "zod";
import { callClaude, extractJson } from "../claude";
import { analyzeText } from "../text-analysis";

const InputSchema = z
  .object({
    objective: z.string(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

interface DecisionResult {
  recommendation: "proceed" | "hold" | "reject";
  confidence: number;
  reasoning: string;
  conditions: string[];
  risks: string[];
}

// ---------------------------------------------------------------------------
// Claude-powered analysis
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert decision analyst. Analyze the given objective and produce a real go/no-go recommendation with thorough justification.

Return ONLY valid JSON (no markdown fences, no explanation) with this exact structure:
{
  "recommendation": "proceed" | "hold" | "reject",
  "confidence": <number 0.0-1.0>,
  "reasoning": "<3-5 sentence explanation of the recommendation, referencing specifics from the objective>",
  "conditions": ["<prerequisite or condition that must be met>"],
  "risks": ["<specific risk or blocker identified>"]
}

Rules:
- "proceed" = the objective is feasible, well-scoped, and should move forward.
- "hold" = the objective has merit but needs clarification, prerequisites, or risk mitigation first.
- "reject" = the objective is infeasible, poorly scoped, or the risks clearly outweigh the benefits.
- Provide 3-6 conditions (prerequisites, success criteria, or governance requirements) specific to this objective.
- Provide 3-6 risks specific to this objective, not generic project management risks.
- The reasoning must reference specific elements from the objective, not boilerplate.
- confidence reflects certainty given the information provided (0.5-0.95).
- Extract key decision factors, pros/cons, prerequisites, and blockers from the objective text.`;

async function analyzeWithClaude(
  objective: string,
  apiKey: string
): Promise<DecisionResult> {
  const raw = await callClaude(apiKey, SYSTEM_PROMPT, `Objective: ${objective}`);
  const parsed = extractJson<DecisionResult>(raw);
  // Validate enum value
  if (!["proceed", "hold", "reject"].includes(parsed.recommendation)) {
    parsed.recommendation = "hold";
  }
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  return parsed;
}

// ---------------------------------------------------------------------------
// Heuristic analysis (no API key)
// ---------------------------------------------------------------------------

function analyzeHeuristic(
  objective: string,
  context: Record<string, unknown> | undefined
): DecisionResult {
  const ta = analyzeText(objective);
  const conditions: string[] = [];
  const risks: string[] = [];

  // Determine recommendation based on risk/positive signal balance
  let recommendation: "proceed" | "hold" | "reject" = "proceed";
  let confidence = 0.70;

  // Check for strong negative signals
  const lower = objective.toLowerCase();
  const rejectSignals = ["abandon", "cancel", "terminate", "infeasible", "impossible", "prohibitive"];
  const hasReject = rejectSignals.some((k) => lower.includes(k));
  if (hasReject) {
    recommendation = "reject";
    confidence = 0.75;
  }

  // Risk signals push toward hold
  if (!hasReject && ta.riskSignals.length >= 3) {
    recommendation = "hold";
    confidence = 0.65;
  } else if (!hasReject && ta.riskSignals.length >= 1 && ta.positiveSignals.length === 0) {
    recommendation = "hold";
    confidence = 0.60;
  }

  // Positive signals boost confidence
  if (ta.positiveSignals.length > 0 && recommendation === "proceed") {
    confidence = Math.min(confidence + ta.positiveSignals.length * 0.05, 0.90);
  }

  // Complexity can push toward hold
  if (ta.complexity === "high" && recommendation === "proceed" && ta.positiveSignals.length === 0) {
    recommendation = "hold";
    confidence = 0.60;
  }

  // --- Build contextual conditions ---
  if (ta.actionType === "migration") {
    conditions.push(
      `Migration plan for ${ta.entities.length > 0 ? ta.entities.join(" and ") : "the target systems"} must include rollback procedures`
    );
    conditions.push("Data validation and reconciliation process must be defined before migration begins");
  }
  if (ta.actionType === "implementation" || ta.actionType === "integration") {
    conditions.push(
      `Technical design and architecture review for ${ta.entities.length > 0 ? ta.entities.slice(0, 2).join("/") : "the solution"} completed and approved`
    );
  }
  if (ta.constraints.includes("timeline constraint")) {
    conditions.push("Timeline feasibility validated against resource availability and scope");
  }
  if (ta.constraints.includes("budget constraint")) {
    conditions.push("Budget allocation confirmed and contingency reserve established");
  }
  if (ta.constraints.includes("regulatory requirement")) {
    conditions.push(`Compliance review completed for applicable regulations${ta.entities.some((e) => /PCI|HIPAA|GDPR|SOC|SOX/i.test(e)) ? ` (${ta.entities.filter((e) => /PCI|HIPAA|GDPR|SOC|SOX/i.test(e)).join(", ")})` : ""}`);
  }
  if (ta.entities.length > 0) {
    conditions.push(`Technical feasibility of ${ta.entities.slice(0, 3).join(", ")} integration validated`);
  }

  // Ensure minimum conditions
  if (conditions.length < 2) {
    conditions.push(`Stakeholder alignment on scope and success criteria for the ${ta.actionType}`);
    conditions.push("Resource plan confirmed with identified team and budget");
  }

  // --- Build contextual risks ---
  for (const signal of ta.riskSignals) {
    if (signal === "tight timeline pressure") {
      risks.push(`Timeline pressure may compromise quality of the ${ta.actionType} deliverables`);
    } else if (signal === "resource constraints") {
      risks.push("Resource limitations could cause delays or force scope reduction");
    } else if (signal === "technical complexity") {
      risks.push(
        `Technical complexity of ${ta.entities.length > 0 ? ta.entities.slice(0, 2).join(" + ") : "the solution"} introduces integration and debugging risks`
      );
    } else if (signal === "vendor/third-party dependency") {
      risks.push("External vendor dependencies create schedule and quality risks outside direct control");
    } else if (signal === "regulatory/compliance exposure") {
      risks.push("Non-compliance could result in legal liability, fines, or forced project changes");
    } else if (signal === "data integrity/migration risk") {
      risks.push("Data migration risks include potential data loss, corruption, or inconsistency");
    } else if (signal === "uncertainty or unproven approach") {
      risks.push("Unproven or experimental approach increases probability of unforeseen issues");
    } else if (signal === "security exposure") {
      risks.push("Security changes may introduce vulnerabilities if not properly reviewed and tested");
    } else {
      risks.push(`${signal.charAt(0).toUpperCase() + signal.slice(1)} may impact successful delivery`);
    }
  }

  // Ensure minimum risks
  if (risks.length < 2) {
    risks.push(`Scope of "${truncate(objective, 60)}" may evolve, requiring re-evaluation of approach`);
    if (risks.length < 2) {
      risks.push(`Dependencies on team capacity and ${ta.entities.length > 0 ? ta.entities[0] : "technology"} readiness may affect delivery`);
    }
  }

  // Context enrichment
  if (context) {
    if (context.budget) conditions.push(`Budget of ${context.budget} reviewed and validated`);
    if (context.timeline) conditions.push(`Timeline target of ${context.timeline} assessed for feasibility`);
    if (context.stakeholders) conditions.push("Key stakeholder sign-off obtained");
  }

  // Build reasoning referencing the objective
  let reasoning: string;
  if (recommendation === "proceed") {
    reasoning =
      `Analysis of "${truncate(objective, 80)}" indicates the initiative is feasible and should proceed. ` +
      `The ${ta.actionType} involves ${ta.entities.length > 0 ? ta.entities.slice(0, 3).join(", ") : "well-understood components"} ` +
      `and ${ta.positiveSignals.length > 0 ? `shows positive indicators (${ta.positiveSignals.join(", ")})` : "aligns with achievable goals"}. ` +
      `${risks.length} risk(s) and ${conditions.length} condition(s) have been identified for monitoring.`;
  } else if (recommendation === "hold") {
    reasoning =
      `Analysis of "${truncate(objective, 80)}" reveals factors requiring attention before proceeding. ` +
      `${ta.riskSignals.length} risk signal(s) detected: ${ta.riskSignals.slice(0, 3).join(", ") || "complexity concerns"}. ` +
      `The recommendation is to address the identified conditions and risk factors before committing resources to this ${ta.actionType}.`;
  } else {
    reasoning =
      `Analysis of "${truncate(objective, 80)}" indicates significant concerns that warrant reconsideration. ` +
      `The objective contains signals suggesting infeasibility or termination. ` +
      `A fundamental reassessment of approach, scope, or viability is recommended before any further investment.`;
  }

  return { recommendation, confidence, reasoning, conditions, risks };
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleDecision(
  body: Record<string, unknown>,
  traceId?: string,
  apiKey?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);

  let result: DecisionResult;
  if (apiKey) {
    try {
      result = await analyzeWithClaude(parsed.objective, apiKey);
    } catch {
      result = analyzeHeuristic(parsed.objective, parsed.context);
    }
  } else {
    result = analyzeHeuristic(parsed.objective, parsed.context);
  }

  return {
    decision_id: crypto.randomUUID(),
    objective: parsed.objective,
    recommendation: result.recommendation,
    confidence: result.confidence,
    reasoning: result.reasoning,
    conditions: result.conditions,
    risks: result.risks,
  };
}
