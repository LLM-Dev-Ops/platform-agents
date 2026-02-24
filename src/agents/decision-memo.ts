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

interface MemoOption {
  option: string;
  description: string;
  pros: string[];
  cons: string[];
}

interface MemoResult {
  background: string;
  analysis: string;
  options: MemoOption[];
  recommendation: string;
  risks: string[];
  next_steps: string[];
}

// ---------------------------------------------------------------------------
// Claude-powered analysis
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior strategy consultant preparing a decision memo. Analyze the given objective and produce a structured decision memo with real analysis.

Return ONLY valid JSON (no markdown fences, no explanation) with this exact structure:
{
  "background": "<2-3 paragraph context and background section explaining why this decision is needed, derived from the objective>",
  "analysis": "<2-3 paragraph analysis section examining the key factors, trade-offs, and considerations specific to this objective>",
  "options": [
    {
      "option": "<option name>",
      "description": "<1-2 sentence description of this approach>",
      "pros": ["<specific advantage>"],
      "cons": ["<specific disadvantage>"]
    }
  ],
  "recommendation": "<2-3 sentence recommended action with specific justification tied to the objective>",
  "risks": ["<specific risk>"],
  "next_steps": ["<specific, actionable next step>"]
}

Rules:
- Background must establish context specific to the objective, not generic project management text.
- Analysis must examine actual trade-offs and considerations for this specific initiative.
- Provide 2-4 options that are genuinely different approaches to achieving the objective. Options must be specific to the domain (not generic "full/phased/MVP" unless that's genuinely appropriate).
- Each option needs 2-4 specific pros and 2-4 specific cons referencing the objective's context.
- The recommendation must choose one option and explain why, referencing specific factors from the analysis.
- Provide 3-6 risks specific to this initiative.
- Provide 4-7 concrete, actionable next steps.
- All content must be specific to the objective, not boilerplate.`;

async function analyzeWithClaude(
  objective: string,
  apiKey: string
): Promise<MemoResult> {
  const raw = await callClaude(apiKey, SYSTEM_PROMPT, `Objective: ${objective}`);
  return extractJson<MemoResult>(raw);
}

// ---------------------------------------------------------------------------
// Heuristic analysis (no API key)
// ---------------------------------------------------------------------------

function analyzeHeuristic(
  objective: string,
  context: Record<string, unknown> | undefined
): MemoResult {
  const ta = analyzeText(objective);
  const entityRef = ta.entities.length > 0
    ? ta.entities.slice(0, 4).join(", ")
    : "the proposed system";
  const actionDesc = ta.actionType !== "general" ? ta.actionType : "initiative";

  // --- Background ---
  const background =
    `This decision memo addresses: "${truncate(objective, 150)}". ` +
    `The initiative falls within the ${ta.domain} domain and involves a ${actionDesc} effort` +
    `${ta.entities.length > 0 ? ` with ${entityRef}` : ""}. ` +
    `${ta.constraints.length > 0 ? `Key constraints shaping this decision include ${ta.constraints.join(", ")}. ` : ""}` +
    `${ta.riskSignals.length > 0 ? `Notable risk factors identified include ${ta.riskSignals.join(", ")}. ` : ""}` +
    `This memo evaluates multiple approaches and provides a recommendation based on the available information.`;

  // --- Analysis ---
  const analysis = buildAnalysis(ta, objective, actionDesc, entityRef);

  // --- Options (domain-specific) ---
  const options = buildOptions(ta, actionDesc, entityRef);

  // --- Recommendation ---
  const recommendation = buildRecommendation(ta, options, actionDesc, entityRef);

  // --- Risks ---
  const risks: string[] = [];
  for (const signal of ta.riskSignals) {
    risks.push(riskFromSignal(signal, ta, actionDesc));
  }
  if (ta.actionType === "migration" && !ta.riskSignals.includes("data integrity/migration risk")) {
    risks.push("Data integrity must be validated throughout the migration process to prevent loss or corruption");
  }
  if (ta.entities.length > 2) {
    risks.push(`Integration complexity across ${ta.entities.slice(0, 3).join(", ")} may introduce unforeseen dependencies`);
  }
  // Minimum risks
  if (risks.length < 3) {
    risks.push(`Scope of the ${actionDesc} may evolve as implementation reveals additional requirements`);
  }
  if (risks.length < 3) {
    risks.push("Team capacity and competing priorities could impact delivery timeline");
  }
  if (risks.length < 3) {
    risks.push(`Organizational adoption and change management for the ${actionDesc} requires proactive attention`);
  }

  // --- Next steps ---
  const nextSteps = buildNextSteps(ta, actionDesc, entityRef, context);

  return { background, analysis, options, recommendation, risks, next_steps: nextSteps };
}

function buildAnalysis(
  ta: ReturnType<typeof analyzeText>,
  objective: string,
  actionDesc: string,
  entityRef: string
): string {
  const parts: string[] = [];

  parts.push(
    `The proposed ${actionDesc} involves ${ta.complexity} complexity` +
    `${ta.entities.length > 0 ? `, touching ${entityRef}` : ""}. ` +
    `${ta.wordCount > 30 ? "The objective describes a multi-faceted initiative requiring coordinated execution across several dimensions." : "The objective scope appears focused and well-defined."}`
  );

  if (ta.riskSignals.length > 0 && ta.positiveSignals.length > 0) {
    parts.push(
      `The analysis reveals both risk factors (${ta.riskSignals.slice(0, 3).join(", ")}) and ` +
      `positive indicators (${ta.positiveSignals.slice(0, 2).join(", ")}). ` +
      `Balancing these factors is central to selecting the right approach.`
    );
  } else if (ta.riskSignals.length > 0) {
    parts.push(
      `Key risk factors include ${ta.riskSignals.slice(0, 3).join(", ")}. ` +
      `These risks inform the option evaluation and weigh toward approaches that include risk mitigation mechanisms.`
    );
  } else if (ta.positiveSignals.length > 0) {
    parts.push(
      `Favorable indicators include ${ta.positiveSignals.join(", ")}. ` +
      `These factors support a more aggressive execution approach.`
    );
  }

  if (ta.constraints.length > 0) {
    parts.push(
      `Constraints shaping the decision: ${ta.constraints.join(", ")}. ` +
      `Each option below has been evaluated against these constraints.`
    );
  }

  return parts.join(" ");
}

function buildOptions(
  ta: ReturnType<typeof analyzeText>,
  actionDesc: string,
  entityRef: string
): MemoOption[] {
  const options: MemoOption[] = [];

  if (ta.actionType === "migration") {
    options.push(
      {
        option: `Big-bang ${actionDesc}`,
        description: `Execute the ${entityRef} migration in a single coordinated cutover event`,
        pros: [
          "Shortest total migration timeline",
          "Avoids running dual systems in parallel",
          `Clean break to new ${ta.entities.length > 1 ? ta.entities[ta.entities.length - 1] : "target"} environment`,
        ],
        cons: [
          "Highest risk of disruption if issues occur",
          "Requires extensive pre-migration testing",
          "No gradual validation — problems surface post-cutover",
        ],
      },
      {
        option: `Phased ${actionDesc}`,
        description: `Migrate ${entityRef} in planned stages, validating each before proceeding`,
        pros: [
          "Risk is contained to each phase",
          "Learnings from early phases improve later phases",
          "Allows partial rollback without full reversion",
        ],
        cons: [
          "Extended total timeline with dual-system operation",
          "Integration overhead between migrated and unmigrated components",
          "Requires careful phase boundary design",
        ],
      },
      {
        option: "Parallel run with gradual cutover",
        description: `Run old and new systems simultaneously, shifting traffic to ${ta.entities.length > 1 ? ta.entities[ta.entities.length - 1] : "the new system"} incrementally`,
        pros: [
          "Lowest risk — instant rollback available at all times",
          "Real-world validation with production traffic",
          "No big-bang cutover event",
        ],
        cons: [
          "Highest infrastructure cost during parallel period",
          "Data synchronization between systems adds complexity",
          "Longest total migration duration",
        ],
      }
    );
  } else if (ta.actionType === "optimization" || ta.actionType === "transformation") {
    options.push(
      {
        option: `Comprehensive ${actionDesc}`,
        description: `Full-scope ${actionDesc} addressing all identified areas simultaneously`,
        pros: [
          "Addresses all improvement areas in one effort",
          `Maximizes impact of ${entityRef} changes`,
          "Avoids incremental rework",
        ],
        cons: [
          "Larger investment of time and resources upfront",
          "Higher execution risk due to broad scope",
          "Longer time to first measurable results",
        ],
      },
      {
        option: "Targeted quick wins first",
        description: `Prioritize highest-impact ${actionDesc} items for immediate execution, defer lower-priority items`,
        pros: [
          "Fastest time to measurable improvement",
          "Builds momentum and organizational confidence",
          "Lower initial resource requirement",
        ],
        cons: [
          "May miss systemic issues addressable only through broader changes",
          "Risk of local optimizations that don't compound",
          "Deferred items may never get addressed",
        ],
      },
      {
        option: "Platform-level redesign",
        description: `Re-architect the underlying platform before optimizing individual components`,
        pros: [
          "Addresses root causes rather than symptoms",
          `Creates foundation for sustained ${entityRef} improvement`,
          "Prevents accumulation of technical debt",
        ],
        cons: [
          "Significant upfront investment before visible results",
          "Higher technical risk and complexity",
          "May over-engineer for current needs",
        ],
      }
    );
  } else {
    // General options for implementation/evaluation/integration
    options.push(
      {
        option: `Full-scope ${actionDesc}`,
        description: `Complete ${actionDesc} of ${entityRef} as described in the objective`,
        pros: [
          "Comprehensive solution addressing all stated requirements",
          `Full value realization from ${entityRef}`,
          "Clear alignment with the stated objective",
        ],
        cons: [
          "Higher initial resource and time investment",
          `Complexity of full ${entityRef} scope may introduce risks`,
          "Longer timeline to initial delivery",
        ],
      },
      {
        option: `Incremental ${actionDesc}`,
        description: `Execute the ${actionDesc} in defined stages with validation between each`,
        pros: [
          "Reduced risk through staged delivery",
          "Allows course correction between stages",
          "Earlier delivery of partial value",
        ],
        cons: [
          "Extended total timeline",
          "Integration overhead between stages",
          `Partial ${actionDesc} may not demonstrate full value`,
        ],
      },
      {
        option: "Minimum viable scope",
        description: `Deliver core capabilities first, expand scope based on validated results`,
        pros: [
          "Fastest path to initial value delivery",
          "Lowest initial resource requirement",
          "Quick validation of approach and assumptions",
        ],
        cons: [
          "Limited scope may not meet all stakeholder needs",
          "Possible rework if expansion requires architectural changes",
          "May not demonstrate strategic value of the full initiative",
        ],
      }
    );
  }

  return options;
}

function buildRecommendation(
  ta: ReturnType<typeof analyzeText>,
  options: MemoOption[],
  actionDesc: string,
  entityRef: string
): string {
  // Recommend based on complexity and risk profile
  if (ta.complexity === "high" || ta.riskSignals.length >= 3) {
    const option = options.find(
      (o) => o.option.toLowerCase().includes("phased") || o.option.toLowerCase().includes("incremental")
    ) || options[1];
    return (
      `"${option.option}" is recommended given the ${ta.complexity} complexity and ${ta.riskSignals.length} identified risk factor(s). ` +
      `This approach provides risk containment through staged execution while maintaining a path to full ${actionDesc} of ${entityRef}. ` +
      `Each phase should have defined success criteria and go/no-go gates.`
    );
  }

  if (ta.riskSignals.length === 0 && ta.positiveSignals.length > 0) {
    const option = options[0];
    return (
      `"${option.option}" is recommended based on favorable indicators (${ta.positiveSignals.slice(0, 2).join(", ")}) and manageable risk profile. ` +
      `The conditions support a direct approach to ${actionDesc}. ` +
      `Standard project governance and milestone tracking should be maintained throughout.`
    );
  }

  // Default: middle option
  const option = options[1] || options[0];
  return (
    `"${option.option}" is recommended as the most balanced approach for this ${actionDesc}. ` +
    `It provides meaningful risk mitigation while maintaining reasonable delivery timelines for ${entityRef}. ` +
    `${ta.constraints.length > 0 ? `This approach best accommodates the identified constraints: ${ta.constraints.join(", ")}.` : "Progress should be tracked against defined milestones."}`
  );
}

function riskFromSignal(
  signal: string,
  ta: ReturnType<typeof analyzeText>,
  actionDesc: string
): string {
  switch (signal) {
    case "tight timeline pressure":
      return `Timeline pressure on the ${actionDesc} may force trade-offs between scope, quality, and delivery date`;
    case "resource constraints":
      return "Resource limitations could create bottlenecks in delivery or force scope reduction";
    case "technical complexity":
      return `Technical complexity of ${ta.entities.length > 0 ? ta.entities.slice(0, 2).join(" and ") : "the solution"} increases probability of integration issues and extended debugging`;
    case "vendor/third-party dependency":
      return "External vendor dependencies introduce risks outside direct control, including schedule slippage and API changes";
    case "regulatory/compliance exposure":
      return `Compliance requirements${ta.entities.some((e) => /PCI|HIPAA|GDPR|SOC|SOX/i.test(e)) ? ` (${ta.entities.filter((e) => /PCI|HIPAA|GDPR|SOC|SOX/i.test(e)).join(", ")})` : ""} may extend timelines and require specialized expertise`;
    case "data integrity/migration risk":
      return "Data migration carries inherent risk of data loss, corruption, or inconsistency that must be actively managed";
    case "uncertainty or unproven approach":
      return "Unproven or experimental elements increase the probability of unforeseen technical challenges";
    case "security exposure":
      return "Security implications require dedicated review and testing cycles to prevent vulnerability introduction";
    case "organizational change risk":
      return "Organizational change and adoption challenges may slow realization of expected benefits";
    case "scope creep potential":
      return "Requirements may evolve during execution, requiring a formal change management process";
    default:
      return `${signal.charAt(0).toUpperCase() + signal.slice(1)} presents a risk to successful ${actionDesc} delivery`;
  }
}

function buildNextSteps(
  ta: ReturnType<typeof analyzeText>,
  actionDesc: string,
  entityRef: string,
  context: Record<string, unknown> | undefined
): string[] {
  const steps: string[] = [];

  if (context) {
    if (context.deadline) steps.push(`Validate ${actionDesc} timeline against the ${context.deadline} deadline`);
    if (context.budget) steps.push(`Confirm budget allocation of ${context.budget} for the recommended approach`);
  }

  steps.push(`Obtain stakeholder approval for the recommended ${actionDesc} approach`);

  if (ta.entities.length > 0) {
    steps.push(`Validate technical feasibility and readiness of ${ta.entities.slice(0, 3).join(", ")}`);
  }

  if (ta.actionType === "migration") {
    steps.push("Develop detailed migration plan including data mapping, rollback procedures, and cutover schedule");
    steps.push("Execute proof-of-concept migration with representative data subset");
  } else if (ta.actionType === "integration") {
    steps.push(`Design integration architecture and define API contracts for ${entityRef}`);
  } else if (ta.actionType === "implementation") {
    steps.push(`Complete technical design document and architecture review for ${entityRef}`);
  }

  steps.push("Assemble implementation team and confirm resource availability");
  steps.push("Define success metrics, acceptance criteria, and reporting cadence");

  if (ta.constraints.includes("regulatory requirement")) {
    steps.push("Initiate compliance review and obtain regulatory guidance for the implementation approach");
  }

  steps.push(`Schedule project kickoff and establish governance structure for the ${actionDesc}`);

  return steps.slice(0, 8);
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleDecisionMemo(
  body: Record<string, unknown>,
  traceId?: string,
  apiKey?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);

  let result: MemoResult;
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
    memo_id: crypto.randomUUID(),
    objective: parsed.objective,
    background: result.background,
    analysis: result.analysis,
    options: result.options,
    recommendation: result.recommendation,
    risks: result.risks,
    next_steps: result.next_steps,
  };
}
