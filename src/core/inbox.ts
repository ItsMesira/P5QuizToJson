/* ============ P5 QUIZ — LOCAL MCP INBOX CLIENT ============
 * The quiz author MCP server binds 127.0.0.1 only. The browser claims a
 * single-use code; it never writes to the inbox and never sees a token.
 */
const INBOX = "http://127.0.0.1:3848";
const CLAIM_TIMEOUT_MS = 4500;

export type InboxErrorCode = "invalid_code" | "expired" | "unreachable" | "http" | "invalid_quiz";

export class InboxError extends Error {
  code: InboxErrorCode;
  status?: number;

  constructor(code: InboxErrorCode, message: string, status?: number) {
    super(message);
    this.name = "InboxError";
    this.code = code;
    this.status = status;
  }
}

export interface InboxClaim {
  quiz: unknown;
  source: string;
}

export async function claimQuiz(input: string): Promise<InboxClaim> {
  const code = String(input ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 9) throw new InboxError("invalid_code", "Enter the 9-character code.");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${INBOX}/api/inbox/claim?code=${encodeURIComponent(code)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new InboxError("unreachable", "The local MCP inbox is not running.");
  } finally {
    window.clearTimeout(timer);
  }

  if (response.status === 410) throw new InboxError("expired", "That code expired or was already used.", 410);
  if (!response.ok) throw new InboxError("http", `MCP inbox returned ${response.status}.`, response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InboxError("invalid_quiz", "The inbox returned invalid JSON.");
  }
  if (!body || typeof body !== "object" || !("quiz" in body) || body.quiz === null) {
    throw new InboxError("invalid_quiz", "The inbox returned no quiz.");
  }
  const record = body as { quiz: unknown; source?: unknown };
  return {
    quiz: record.quiz,
    source: typeof record.source === "string" && record.source ? record.source : "mcp",
  };
}
