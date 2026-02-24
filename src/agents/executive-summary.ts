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

interface SummaryResult {
  executive_summary: string;
  key_findings: string[];
  metrics: Record<string, unknown>;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Claude-powered analysis
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an executive advisor preparing a concise executive brief. Analyze the given objective and produce a real executive summary with actionable findings and recommendations.

Return ONLY valid JSON (no markdown fences, no explanation) with this exact structure:
{
  "executive_summary": "<2-4 paragraph executive narrative covering: situation analysis, key findings, and recommended path forward. Must reference specifics from the objective.>",
  "key_findings": [
    "<specific finding derived from analyzing the objective>"
  ],
  "metrics": {
    "complexity_score": "low" | "medium" | "high",
    "estimated_impact": "<contextual impact assessment>",
    "strategic_alignment": <number 0.0-1.0>
  },
  "recommendation": "<2-3 sentence actionable recommendation with rationale tied to the objective>"
}

Rules:
- The executive_summary must provide a genuine situation analysis, not template text. Reference the specific initiative, technologies, risks, and opportunities described.
- Provide 4-7 key_findings that a real executive would care about. Each should be specific and derived from the objective text.
- metrics.complexity_score should reflect the actual complexity of the described initiative.
- metrics.estimated_impact should describe the expected business/operational impact.
- metrics.strategic_alignment (0-1) should reflect how well the initiative aligns with typical organizational priorities.
- The recommendation must be specific, actionable, and reference elements from the objective.
- Write in professional executive language, concise and direct.`;

async function analyzeWithClaude(
  objective: string,
  apiKey: string
): Promise<SummaryResult> {
  const raw = await callClaude(apiKey, SYSTEM_PROMPT, `Objective: ${objective}`);
  const parsed = extractJson<SummaryResult>(raw);
  return parsed;
}

// ---------------------------------------------------------------------------
// Heuristic analysis (no API key)
// ---------------------------------------------------------------------------

function analyzeHeuristic(
  objective: string,
  context: Record<string, unknown> | undefined
): SummaryResult {
  const ta = analyzeText(objective);
  const keyFindings: string[] = [];

  // Build situation-aware executive summary
  const entityRef = ta.entities.length > 0
    ? ta.entities.slice(0, 4).join(", ")
    : "the described systems";
  const actionDesc = ta.actionType !== "general"
    ? ta.actionType
    : "initiative";

  // --- Executive summary paragraphs ---
  const situation =
    `This executive summary addresses the proposed ${actionDesc}: "${truncate(objective, 120)}". ` +
    `The initiative operates within the ${ta.domain} domain${ta.entities.length > 0 ? `, involving ${entityRef}` : ""}. ` +
    `${ta.constraints.length > 0 ? `Key constraints include ${ta.constraints.join(", ")}. ` : ""}` +
    `${ta.complexity === "high" ? "The scope and complexity of this effort are significant and warrant careful planning." : ta.complexity === "medium" ? "The initiative is moderately complex and requires structured execution." : "The scope appears manageable with appropriate planning."}`;

  const riskParagraph = ta.riskSignals.length > 0
    ? `Risk assessment identifies the following concerns: ${ta.riskSignals.join(", ")}. These factors should be addressed in the project plan to avoid delays or cost overruns.`
    : `Initial risk assessment does not identify critical blockers, though standard project management risks apply.`;

  const opportunityParagraph = ta.positiveSignals.length > 0
    ? `Positive indicators include ${ta.positiveSignals.join(", ")}, suggesting favorable conditions for success.`
    : `The initiative should be evaluated on its strategic merit and expected return on investment.`;

  const executiveSummary = `${situation}\n\n${riskParagraph} ${opportunityParagraph}`;

  // --- Key findings ---
  if (ta.actionType === "migration") {
    keyFindings.push(
      `The ${ta.entities.length >= 2 ? `${ta.entities[0]} to ${ta.entities[1]}` : "proposed"} migration requires a detailed data transfer plan, compatibility validation, and rollback procedures`
    );
    keyFindings.push("Migration downtime window and rollback triggers must be defined before execution begins");
  }
  if (ta.actionType === "implementation" || ta.actionType === "integration") {
    keyFindings.push(
      `${entityRef} ${ta.actionType} requires architectural review and integration testing strategy`
    );
  }
  if (ta.actionType === "optimization") {
    keyFindings.push(
      `Current performance baselines must be established before ${entityRef} optimization to measure improvement`
    );
  }

  for (const signal of ta.riskSignals.slice(0, 3)) {
    if (signal === "tight timeline pressure") {
      keyFindings.push("Timeline pressure may require scope prioritization to deliver core value on schedule");
    } else if (signal === "regulatory/compliance exposure") {
      keyFindings.push(
        `Compliance requirements${ta.entities.some((e) => /PCI|HIPAA|GDPR|SOC|SOX/i.test(e)) ? ` (${ta.entities.filter((e) => /PCI|HIPAA|GDPR|SOC|SOX/i.test(e)).join(", ")})` : ""} will impact timeline and require dedicated review cycles`
      );
    } else if (signal === "technical complexity") {
      keyFindings.push(
        `Technical complexity of the ${actionDesc} warrants a phased approach with validation at each stage`
      );
    } else if (signal === "resource constraints") {
      keyFindings.push("Resource constraints identified; team capacity must be validated against delivery commitments");
    } else if (signal === "security exposure") {
      keyFindings.push("Security implications require threat modeling and security review before implementation");
    }
  }

  for (const signal of ta.positiveSignals.slice(0, 2)) {
    if (signal === "proven technology") {
      keyFindings.push(`Use of proven, established technology (${entityRef}) reduces technical risk`);
    } else if (signal === "efficiency gain") {
      keyFindings.push("Expected efficiency gains from automation or process improvement support the business case");
    } else if (signal === "strategic alignment") {
      keyFindings.push("The initiative aligns with stated strategic priorities, supporting organizational buy-in");
    }
  }

  // Ensure minimum findings
  if (keyFindings.length < 3) {
    keyFindings.push(`Resource allocation for the ${actionDesc} should be validated against project requirements`);
  }
  if (keyFindings.length < 3) {
    keyFindings.push("Success metrics and acceptance criteria should be defined before execution begins");
  }
  if (keyFindings.length < 3) {
    keyFindings.push("Stakeholder communication cadence should be established to maintain alignment throughout delivery");
  }

  // --- Metrics ---
  const metrics: Record<string, unknown> = {
    complexity_score: ta.complexity,
    estimated_impact:
      ta.complexity === "high"
        ? "high — significant operational or strategic change"
        : ta.complexity === "medium"
          ? "moderate — meaningful improvement with manageable scope"
          : "incremental — targeted improvement with contained scope",
    strategic_alignment:
      ta.positiveSignals.includes("strategic alignment")
        ? 0.90
        : ta.positiveSignals.length > 0
          ? 0.78
          : 0.65,
  };

  if (context) {
    if (context.budget) metrics.budget_status = `reviewed (${context.budget})`;
    if (context.team_size) metrics.team_coverage = `assessed (${context.team_size} members)`;
  }

  // --- Recommendation ---
  let recommendation: string;
  if (ta.riskSignals.length >= 3 || ta.complexity === "high") {
    recommendation =
      `Proceed with the ${actionDesc} using a phased approach to manage complexity and risk. ` +
      `Prioritize addressing ${ta.riskSignals.slice(0, 2).join(" and ") || "identified risks"} before committing to full-scale execution. ` +
      `Establish clear phase gates with go/no-go criteria at each milestone.`;
  } else if (ta.riskSignals.length > 0) {
    recommendation =
      `Proceed with the ${actionDesc} with targeted risk mitigation for ${ta.riskSignals.join(", ")}. ` +
      `${ta.entities.length > 0 ? `Validate ${ta.entities.slice(0, 2).join(" and ")} readiness before full commitment. ` : ""}` +
      `Monitor identified risks through regular review cycles.`;
  } else {
    recommendation =
      `Proceed with the ${actionDesc}${ta.entities.length > 0 ? ` involving ${entityRef}` : ""}. ` +
      `The initiative shows favorable indicators and manageable risk. ` +
      `Define success metrics and establish reporting cadence to track progress.`;
  }

  return { executive_summary: executiveSummary, key_findings: keyFindings, metrics, recommendation };
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleExecutiveSummary(
  body: Record<string, unknown>,
  traceId?: string,
  apiKey?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);

  let result: SummaryResult;
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
    summary_id: crypto.randomUUID(),
    objective: parsed.objective,
    executive_summary: result.executive_summary,
    key_findings: result.key_findings,
    metrics: result.metrics,
    recommendation: result.recommendation,
  };
}
