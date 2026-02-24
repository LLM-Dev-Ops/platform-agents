import type { IncomingMessage, ServerResponse } from "http";

export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Correlation-ID"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function handleCors(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
