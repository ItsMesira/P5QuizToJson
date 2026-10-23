/* ============ P5 QUIZ — LOCAL QUIZ AUTHOR MCP SERVER ============
 * stdio JSON-RPC for MCP clients plus a loopback-only inbox HTTP server.
 * The schema, validator and repairer are bundled from the same TypeScript the
 * browser uses (mcp/build.mjs), so an AI-authored quiz can never drift from the
 * format the game actually accepts.
 *
 * Run: npm run mcp
 * Inbox: http://127.0.0.1:3848 (memory-only, single-use, ten-minute TTL).
 * Hosted transport is deliberately not implemented.
 */
import http from "node:http";
import { createInterface } from "node:readline";
import { randomInt, randomUUID } from "node:crypto";
import {
  buildPrompt,
  defaultFields,
  QUIZ_HARD_RULES,
  QUIZ_SCHEMA_REF,
  repairQuiz,
  validateQuiz,
} from "./.build/core.mjs";

const PORT = Number(process.env.P5Q_MCP_INBOX_PORT || 3848);
const MCP_TOKEN = process.env.P5Q_MCP_TOKEN || "";
const MCP_SCOPES = new Set(
  String(process.env.P5Q_MCP_SCOPES || "author:validate author:save")
    .split(/[\s,]+/)
    .filter(Boolean),
);
const HOST = "127.0.0.1";
const MAX_BODY = 2_000_000;
const TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const QUESTION_TYPES = ["multiple", "multi", "boolean", "fill", "order", "match", "numeric", "open", "hotspot"];
const LIBRARY = new Map();
const rateBuckets = new Map();

const LOCAL_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5183",
  "http://127.0.0.1:5183",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);
const PRODUCTION_ORIGINS = new Set([
  "https://www.tykunanon.online",
  "https://tykunanon.online",
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (LOCAL_ORIGINS.has(origin) || PRODUCTION_ORIGINS.has(origin)) return true;
  // Vercel preview/production hosts for the sibling quiz app.
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
}

function makeCode() {
  let raw = "";
  for (let i = 0; i < 9; i++) raw += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 9)}`;
}

const normalizeCode = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function sweep(now = Date.now()) {
  for (const [code, entry] of LIBRARY) if (entry.expiresAt <= now) LIBRARY.delete(code);
}

function allowedRate(ip, kind, limit) {
  const now = Date.now();
  const key = `${ip}:${kind}`;
  const bucket = (rateBuckets.get(key) ?? []).filter((at) => now - at < 60_000);
  if (bucket.length >= limit) {
    rateBuckets.set(key, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
  return true;
}

function corsHeaders(origin) {
  if (isAllowedOrigin(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "600",
      "access-control-allow-private-network": "true",
      vary: "Origin",
    };
  }
  return { vary: "Origin" };
}

function send(res, status, payload, origin) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(origin),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function hasScope(scope) {
  return !MCP_TOKEN || MCP_SCOPES.has(scope);
}

const httpServer = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const ip = req.socket.remoteAddress ?? "local";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    send(res, 200, { ok: true, inbox: LIBRARY.size, name: "p5-quiz-author" }, origin);
    return;
  }

  if (req.url === "/api/inbox" && req.method === "POST") {
    if (MCP_TOKEN && req.headers.authorization !== `Bearer ${MCP_TOKEN}`) {
      send(res, 401, { error: "unauthorized" }, origin);
      return;
    }
    if (!hasScope("author:save")) {
      send(res, 403, { error: "missing_scope", scope: "author:save" }, origin);
      return;
    }
    if (!allowedRate(ip, "save", 10)) {
      send(res, 429, { error: "rate_limited" }, origin);
      return;
    }
    try {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        send(res, 400, { error: "invalid_json" }, origin);
        return;
      }
      if (!body || typeof body !== "object" || typeof body.quiz !== "object" || body.quiz === null) {
        send(res, 400, { error: "invalid_quiz" }, origin);
        return;
      }
      // Re-validate at the boundary. The MCP tool already did this; the inbox
      // must not trust a direct POST either.
      const checked = validateQuiz(body.quiz);
      if (!checked.ok) {
        send(res, 400, { error: "invalid_quiz", errors: checked.errors }, origin);
        return;
      }
      sweep();
      const code = makeCode();
      const normalized = normalizeCode(code);
      const expiresAt = Date.now() + TTL_MS;
      LIBRARY.set(normalized, { quiz: checked.quiz, expiresAt, id: randomUUID() });
      send(res, 201, { inboxId: LIBRARY.get(normalized).id, code, expiresAt }, origin);
    } catch (error) {
      send(res, error?.status === 413 ? 413 : 400, { error: error?.status === 413 ? "too_large" : "bad_request" }, origin);
    }
    return;
  }

  if (req.url?.startsWith("/api/inbox/claim") && req.method === "GET") {
    if (!allowedRate(ip, "claim", 30)) {
      send(res, 429, { error: "rate_limited" }, origin);
      return;
    }
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const code = normalizeCode(url.searchParams.get("code"));
    sweep();
    const entry = LIBRARY.get(code);
    if (!entry) {
      send(res, 410, { error: "expired_or_used" }, origin);
      return;
    }
    // Single-use: remove before returning. A second claim is 410.
    LIBRARY.delete(code);
    send(res, 200, { quiz: entry.quiz, source: "mcp" }, origin);
    return;
  }

  send(res, 404, { error: "not_found" }, origin);
});

httpServer.on("error", (error) => {
  process.stderr.write(`p5-quiz-author inbox error: ${error.message}\n`);
});
httpServer.listen(PORT, HOST, () => {
  process.stderr.write(`p5-quiz-author inbox: http://${HOST}:${PORT} (memory, TTL 10m, single-use)\n`);
});

/* ---------------- MCP stdio ---------------- */

const TOOL_DEFS = [
  {
    name: "get_quiz_rules",
    description:
      "Return the exact P5 quiz JSON schema, hard rules and supported question types. Call this before writing quiz content when the client has no p5-quiz-author skill.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "build_quiz_prompt",
    description:
      "Build the exact master prompt for a P5 quiz. Use this instead of inventing a schema or re-typing the rules. The resulting prompt asks a model to output raw quiz JSON.",
    inputSchema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string" },
        title: { type: "string" },
        audience: { type: "string", enum: ["kids", "teens", "adults", "experts"] },
        language: { type: "string" },
        count: { type: "number" },
        sections: { type: "number" },
        difficulty: { type: "string", enum: ["chill", "balanced", "brutal"] },
        types: { type: "array", items: { type: "string", enum: QUESTION_TYPES } },
        mode: { type: "string", enum: ["standard", "survival", "rapid"] },
        timeLimit: { type: ["number", "null"] },
        explanations: { type: "boolean" },
        hints: { type: "boolean" },
        negativeMarking: { type: "boolean" },
        tone: { type: "string", enum: ["fun", "serious", "dramatic"] },
        notes: { type: "string" },
        spaced: { type: "boolean" },
        answerKey: { type: "boolean" },
        exampleEmbed: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "validate_quiz",
    description:
      "Validate and repair a raw P5 quiz JSON string. Returns ok, the repaired quiz, a repair log and any remaining errors. It never throws for bad content; read the named paths and fix only those.",
    inputSchema: {
      type: "object",
      required: ["raw"],
      properties: { raw: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "save_quiz",
    description:
      "Validate/repair a raw quiz and place it in the loopback inbox for the P5 app to claim. Returns a single-use code that expires in ten minutes. Never call this with invented or unvalidated content.",
    inputSchema: {
      type: "object",
      required: ["raw"],
      properties: { raw: { type: "string" } },
      additionalProperties: false,
    },
  },
];

function textResult(value, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function clampInt(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function quizFields(args) {
  const f = defaultFields();
  f.topic = String(args.topic ?? "").trim();
  if (!f.topic) throw new Error("topic is required");
  if (typeof args.title === "string") f.title = args.title;
  if (["kids", "teens", "adults", "experts"].includes(args.audience)) f.audience = args.audience;
  if (typeof args.language === "string" && args.language.trim()) f.language = args.language.trim();
  f.count = clampInt(args.count, 1, 60, f.count);
  f.sections = clampInt(args.sections, 1, 12, f.sections);
  if (["chill", "balanced", "brutal"].includes(args.difficulty)) f.difficulty = args.difficulty;
  if (Array.isArray(args.types)) {
    const picked = args.types.filter((type) => QUESTION_TYPES.includes(type));
    if (picked.length) f.types = [...new Set(picked)];
  }
  if (["standard", "survival", "rapid"].includes(args.mode)) f.mode = args.mode;
  if (args.timeLimit === null) f.timeLimit = null;
  else if (typeof args.timeLimit === "number") f.timeLimit = clampInt(args.timeLimit, 5, 300, f.timeLimit ?? 20);
  if (typeof args.explanations === "boolean") f.explanations = args.explanations;
  if (typeof args.hints === "boolean") f.hints = args.hints;
  if (typeof args.negativeMarking === "boolean") f.negativeMarking = args.negativeMarking;
  if (["fun", "serious", "dramatic"].includes(args.tone)) f.tone = args.tone;
  if (typeof args.notes === "string") f.notes = args.notes;
  if (typeof args.spaced === "boolean") f.spaced = args.spaced;
  if (typeof args.answerKey === "boolean") f.answerKey = args.answerKey;
  if (typeof args.exampleEmbed === "boolean") f.exampleEmbed = args.exampleEmbed;
  return f;
}

function validateRaw(raw) {
  if (typeof raw !== "string") {
    return { ok: false, errors: [{ path: "$", message: "raw must be a JSON string" }], report: [] };
  }
  const result = repairQuiz(raw);
  return result.ok
    ? { ok: true, quiz: result.quiz, report: result.report, errors: [] }
    : { ok: false, report: result.report, errors: result.errors };
}

async function callTool(name, args = {}) {
  if (name === "get_quiz_rules") {
    return {
      schema: QUIZ_SCHEMA_REF,
      rules: QUIZ_HARD_RULES,
      questionTypes: QUESTION_TYPES,
      notes: [
        "Return raw JSON only. Do not wrap it in Markdown fences.",
        "Use exactly one correct answer for multiple/boolean, two or more for multi.",
        "For fill answers use correctText; for numeric use answer + tolerance.",
        "Images must be https:// or data:image/ URLs.",
      ],
    };
  }

  if (name === "build_quiz_prompt") {
    const fields = quizFields(args);
    return { prompt: buildPrompt(fields), fields };
  }

  if (name === "validate_quiz") {
    if (MCP_TOKEN && !hasScope("author:validate")) throw new Error("Token lacks author:validate.");
    return validateRaw(args.raw);
  }

  if (name === "save_quiz") {
    if (MCP_TOKEN && !hasScope("author:save")) throw new Error("Token lacks author:save.");
    const result = validateRaw(args.raw);
    if (!result.ok || !result.quiz) {
      const detail = (result.errors ?? [])
        .slice(0, 12)
        .map((error) => `${error.path}: ${error.message}`)
        .join("\n");
      throw new Error(`Quiz did not validate; nothing was saved.${detail ? `\n${detail}` : ""}`);
    }
    let response;
    try {
      response = await fetch(`http://${HOST}:${PORT}/api/inbox`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(MCP_TOKEN ? { authorization: `Bearer ${MCP_TOKEN}` } : {}),
        },
        body: JSON.stringify({ quiz: result.quiz }),
      });
    } catch {
      throw new Error("The loopback inbox is not running. Start the MCP server before saving.");
    }
    if (!response.ok) throw new Error(`Inbox rejected the save (${response.status}).`);
    const data = await response.json();
    return { ok: true, code: data.code, expiresAt: data.expiresAt, inboxId: data.inboxId };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function respond(id, result, error) {
  const message = error
    ? { jsonrpc: "2.0", id, error: { code: -32603, message: String(error.message ?? error) } }
    : { jsonrpc: "2.0", id, result };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
    return;
  }
  const { id, method, params } = request;
  if (method === "notifications/initialized") return;
  if (method === "initialize") {
    respond(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "p5-quiz-author", version: "0.1.0" },
    });
    return;
  }
  if (method === "ping") {
    respond(id, {});
    return;
  }
  if (method === "tools/list") {
    respond(id, { tools: TOOL_DEFS });
    return;
  }
  if (method === "resources/list") {
    respond(id, { resources: [] });
    return;
  }
  if (method === "prompts/list") {
    respond(id, { prompts: [] });
    return;
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments ?? {});
      respond(id, textResult(result));
    } catch (error) {
      respond(id, textResult(String(error.message ?? error), true));
    }
    return;
  }
  if (id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } })}\n`);
  }
});

function shutdown() {
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
