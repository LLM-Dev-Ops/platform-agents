const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

interface ClaudeContentBlock {
  type: string;
  text: string;
}

interface ClaudeMessageResponse {
  content: ClaudeContentBlock[];
}

/**
 * Call the Anthropic Messages API and return the text response.
 * Throws on HTTP errors or timeouts.
 */
export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(50000), // 50s to stay within 60s function timeout
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Claude API ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as ClaudeMessageResponse;
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Extract JSON from Claude's response, handling markdown code fences.
 */
export function extractJson<T = unknown>(text: string): T {
  // Try markdown code block first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim()) as T;
  }
  // Try raw JSON (find first { or [)
  const startIdx = text.search(/[{[]/);
  if (startIdx >= 0) {
    const endChar = text[startIdx] === "{" ? "}" : "]";
    let depth = 0;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === text[startIdx]) depth++;
      else if (text[i] === endChar) depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(startIdx, i + 1)) as T;
      }
    }
  }
  // Last resort: parse the whole string
  return JSON.parse(text.trim()) as T;
}
