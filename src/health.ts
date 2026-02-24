import type { ServerResponse } from "http";
import { setCorsHeaders } from "./cors";

export function handleHealth(res: ServerResponse): void {
  setCorsHeaders(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "healthy",
      service: "platform-agents",
      timestamp: new Date().toISOString(),
      agents: [
        "decision",
        "executive-summary",
        "decision-memo",
        "risk-score",
      ],
    })
  );
}
