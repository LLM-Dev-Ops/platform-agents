import crypto from "crypto";

export interface LayerEntry {
  layer: string;
  status: "completed" | "failed" | "skipped";
  duration_ms?: number;
}

export interface ExecutionMetadata {
  trace_id: string;
  timestamp: string;
  service: string;
  execution_id: string;
}

export interface EnvelopedResponse {
  data: Record<string, unknown>;
  execution_metadata: ExecutionMetadata;
  layers_executed: LayerEntry[];
}

export function buildEnvelope(
  data: Record<string, unknown>,
  layers: LayerEntry[],
  traceId?: string
): EnvelopedResponse {
  return {
    data,
    execution_metadata: {
      trace_id: traceId || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      service: "platform-agents",
      execution_id: crypto.randomUUID(),
    },
    layers_executed: layers,
  };
}
