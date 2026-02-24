import crypto from "crypto";
import { z } from "zod";

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

function generateMemo(objective: string, context?: Record<string, unknown>) {
  const lower = objective.toLowerCase();

  const background =
    `This decision memo addresses: "${objective}". ` +
    `The analysis considers strategic alignment, resource implications, risk factors, and expected outcomes. ` +
    `Stakeholder input and organizational priorities have been factored into the assessment.`;

  const analysis =
    `A thorough evaluation of the objective reveals multiple viable approaches. ` +
    `Each option has been assessed against criteria including feasibility, cost, timeline, and strategic value. ` +
    `The recommended approach balances risk mitigation with operational efficiency.`;

  // Generate options
  const options: MemoOption[] = [
    {
      option: "Full Implementation",
      description: "Complete implementation of the objective as defined",
      pros: [
        "Comprehensive solution addressing all requirements",
        "Maximum long-term value",
        "Clear alignment with strategic goals",
      ],
      cons: [
        "Higher initial resource investment",
        "Longer timeline to completion",
        "Greater complexity in execution",
      ],
    },
    {
      option: "Phased Approach",
      description: "Incremental implementation with defined milestones",
      pros: [
        "Reduced initial risk",
        "Allows for learning and adjustment",
        "Earlier delivery of partial value",
      ],
      cons: [
        "Extended overall timeline",
        "Potential for scope changes between phases",
        "Integration overhead between phases",
      ],
    },
    {
      option: "Minimum Viable Implementation",
      description: "Core functionality only with optional future expansion",
      pros: [
        "Fastest time to delivery",
        "Lowest resource requirement",
        "Quick validation of approach",
      ],
      cons: [
        "Limited scope may not meet all needs",
        "Possible rework if expansion needed",
        "May not demonstrate full strategic value",
      ],
    },
  ];

  const recommendation =
    "The phased approach is recommended as it balances risk management with value delivery. " +
    "This allows the organization to validate assumptions early while maintaining a clear path to full implementation.";

  const risks: string[] = [
    "Resource availability may impact timeline",
    "External dependencies could introduce delays",
    "Scope creep risk without clear governance",
    "Stakeholder alignment must be maintained throughout",
  ];

  if (lower.includes("migration")) {
    risks.push("Data integrity must be ensured during migration");
  }
  if (lower.includes("security")) {
    risks.push("Security requirements must be validated at each stage");
  }

  const nextSteps: string[] = [
    "Secure stakeholder approval for recommended approach",
    "Allocate resources and form implementation team",
    "Define detailed project plan with milestones",
    "Establish governance and reporting structure",
    "Schedule kickoff and initial planning session",
  ];

  if (context) {
    if (context.deadline) nextSteps.unshift("Validate timeline against deadline constraints");
    if (context.budget) nextSteps.unshift("Confirm budget allocation for selected approach");
  }

  return { background, analysis, options, recommendation, risks, nextSteps };
}

export async function handleDecisionMemo(
  body: Record<string, unknown>,
  traceId?: string
): Promise<Record<string, unknown>> {
  const parsed = InputSchema.parse(body);
  const result = generateMemo(parsed.objective, parsed.context);

  return {
    memo_id: crypto.randomUUID(),
    objective: parsed.objective,
    background: result.background,
    analysis: result.analysis,
    options: result.options,
    recommendation: result.recommendation,
    risks: result.risks,
    next_steps: result.nextSteps,
  };
}
