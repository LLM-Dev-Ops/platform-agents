import type { IncomingMessage, ServerResponse } from "http";
import { handleCors, setCorsHeaders } from "./cors";
import { handleHealth } from "./health";
import { resolveAgent } from "./router";
import { buildEnvelope } from "./envelope";
import type { LayerEntry } from "./envelope";
import * as functions from "@google-cloud/functions-framework";

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // Cloud Functions may have already parsed the body
    if ((req as any).body) {
      resolve((req as any).body as Record<string, unknown>);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function persistToRuvector(
  data: Record<string, unknown>,
  traceId: string
): Promise<void> {
  const url = process.env.RUVECTOR_SERVICE_URL;
  if (!url) return;

  try {
    await fetch(`${url}/v1/vectors/store`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": traceId,
      },
      body: JSON.stringify({
        source: "platform-agents",
        trace_id: traceId,
        payload: data,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-blocking, failure-tolerant — silently ignore
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // CORS preflight
  if (handleCors(req, res)) return;

  const url = (req as any).url || req.url || "/";
  const path = url.split("?")[0].replace(/\/+$/, "") || "/";

  // Health check
  if (path === "/health" || path.endsWith("/health")) {
    handleHealth(res);
    return;
  }

  // Route: /v1/platform/<agent-slug>
  const match = path.match(/\/v1\/platform\/([a-z-]+)$/);
  if (!match || req.method !== "POST") {
    sendJson(res, 404, {
      error: "Not found",
      message: `No route for ${req.method} ${path}`,
      available_routes: [
        "POST /v1/platform/decision",
        "POST /v1/platform/executive-summary",
        "POST /v1/platform/decision-memo",
        "POST /v1/platform/risk-score",
        "GET /health",
      ],
    });
    return;
  }

  const slug = match[1];
  const agent = resolveAgent(slug);
  if (!agent) {
    sendJson(res, 404, {
      error: "Unknown agent",
      message: `Agent "${slug}" not found`,
    });
    return;
  }

  const traceId =
    (req.headers["x-correlation-id"] as string) ||
    crypto.randomUUID();

  let body: Record<string, unknown>;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, buildEnvelope(
      { error: "Invalid JSON body" },
      [{ layer: "AGENT_ROUTING", status: "failed" }],
      traceId
    ));
    return;
  }

  const layers: LayerEntry[] = [
    { layer: "AGENT_ROUTING", status: "completed" },
  ];

  const start = performance.now();
  try {
    const data = await agent.handler(body, traceId);
    const duration_ms = Math.round(performance.now() - start);

    layers.push({
      layer: agent.layerName,
      status: "completed",
      duration_ms,
    });

    const envelope = buildEnvelope(data, layers, traceId);
    sendJson(res, 200, envelope);

    // Fire-and-forget persistence
    persistToRuvector(data, traceId);
  } catch (err: any) {
    const duration_ms = Math.round(performance.now() - start);
    layers.push({
      layer: agent.layerName,
      status: "failed",
      duration_ms,
    });

    const status = err.statusCode || 400;
    sendJson(
      res,
      status,
      buildEnvelope(
        { error: err.message || "Agent execution failed" },
        layers,
        traceId
      )
    );
  }
}

import crypto from "crypto";

functions.http("handler", handleRequest);
