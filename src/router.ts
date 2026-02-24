import { handleDecision } from "./agents/decision";
import { handleExecutiveSummary } from "./agents/executive-summary";
import { handleDecisionMemo } from "./agents/decision-memo";
import { handleRiskScore } from "./agents/risk-score";

export type AgentHandler = (
  body: Record<string, unknown>,
  traceId?: string,
  apiKey?: string
) => Promise<Record<string, unknown>>;

interface AgentRoute {
  handler: AgentHandler;
  layerName: string;
}

const routes: Record<string, AgentRoute> = {
  decision: {
    handler: handleDecision,
    layerName: "PLATFORM_DECISION",
  },
  "executive-summary": {
    handler: handleExecutiveSummary,
    layerName: "PLATFORM_EXECUTIVE_SUMMARY",
  },
  "decision-memo": {
    handler: handleDecisionMemo,
    layerName: "PLATFORM_DECISION_MEMO",
  },
  "risk-score": {
    handler: handleRiskScore,
    layerName: "PLATFORM_RISK_SCORE",
  },
};

export function resolveAgent(slug: string): AgentRoute | undefined {
  return routes[slug];
}
