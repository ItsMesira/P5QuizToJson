/* ============ P5 QUIZ — MCP AUTHORING TEST ============
 * Builds the shared core, starts the real stdio server + loopback inbox, then
 * exercises the tools and the single-use claim. No network beyond 127.0.0.1.
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 3992;
const TOKEN = "mcptest-token";
const fixture = readFileSync(join(ROOT, "public", "sample-quizzes", "general.json"), "utf8");

execFileSync(process.execPath, [join(ROOT, "mcp", "build.mjs")], { cwd: ROOT, stdio: "ignore" });
const core = await import(pathToFileURL(join(ROOT, "mcp", ".build", "core.mjs")).href);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok    " + name);
  } catch (error) {
    failed++;
    console.log("  FAIL  " + name + "\n        " + error.message);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

const server = spawn(process.execPath, [join(ROOT, "mcp", "server.mjs")], {
  cwd: ROOT,
  env: {
    ...process.env,
    P5Q_MCP_INBOX_PORT: String(PORT),
    P5Q_MCP_TOKEN: TOKEN,
  },
  stdio: ["pipe", "pipe", "ignore"],
});
const lines = createInterface({ input: server.stdout, crlfDelay: Infinity });
const waiting = new Map();
let nextId = 1;
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    const pending = waiting.get(message.id);
    if (pending) {
      waiting.delete(message.id);
      pending(message);
    }
  } catch {
    /* ignore malformed test noise */
  }
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, 5000);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function tool(name, args) {
  const message = await request("tools/call", { name, arguments: args });
  if (message.error) return { error: message.error };
  const text = message.result?.content?.[0]?.text ?? "{}";
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ...message.result, data, text };
}

async function health() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("inbox did not start");
}

console.log("\nP5 QUIZ — MCP authoring");
await health();

const init = await request("initialize", { protocolVersion: "2024-11-05" });
test("initialize exposes the tools capability", () => {
  assert(init.result?.capabilities?.tools, "tools capability missing");
  assert(init.result?.serverInfo?.name === "p5-quiz-author", "server name: " + init.result?.serverInfo?.name);
});

const list = await request("tools/list");
test("all four authoring tools are listed", () => {
  const names = (list.result?.tools ?? []).map((tool) => tool.name);
  for (const name of ["get_quiz_rules", "build_quiz_prompt", "validate_quiz", "save_quiz"]) {
    assert(names.includes(name), "missing " + name);
  }
});

const rules = await tool("get_quiz_rules", {});
test("get_quiz_rules returns the shared schema and hard rules", () => {
  assert(rules.data?.schema?.includes("THE JSON SCHEMA"), "schema block missing");
  assert(rules.data?.rules?.includes("HARD RULES"), "hard rules missing");
  assert(rules.data?.questionTypes?.includes("hotspot"), "question types missing");
});

const prompt = await tool("build_quiz_prompt", { topic: "Cell biology", count: 3, types: ["multiple", "fill"] });
test("build_quiz_prompt returns the real master prompt", () => {
  assert(prompt.data?.prompt?.includes("Cell biology"), "topic missing");
  assert(prompt.data?.prompt?.includes("THE JSON SCHEMA"), "schema missing");
  assert(prompt.data?.fields?.count === 3, "count not applied");
});

const validation = await tool("validate_quiz", { raw: fixture });
test("validate_quiz accepts the shipped sample", () => {
  assert(validation.data?.ok === true, JSON.stringify(validation.data?.errors));
  assert(validation.data.quiz?.title === "General Knowledge", "title changed");
});

const bad = await tool("validate_quiz", { raw: "this is not json" });
test("bad content is a readable validation result, not a tool throw", () => {
  assert(bad.data?.ok === false, "bad raw was accepted");
  assert(Array.isArray(bad.data?.errors) && bad.data.errors.length > 0, "errors missing");
});

const unauthorized = await fetch(`http://127.0.0.1:${PORT}/api/inbox`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ quiz: JSON.parse(fixture) }),
});
test("inbox save is 401 without the configured bearer token", () => {
  assert(unauthorized.status === 401, "unauth save status: " + unauthorized.status);
});

const save = await tool("save_quiz", { raw: fixture });
test("save_quiz returns a one-use claim code", () => {
  assert(save.data?.ok === true, JSON.stringify(save.data));
  assert(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(save.data.code), "bad code: " + save.data.code);
});

const claim = await fetch(`http://127.0.0.1:${PORT}/api/inbox/claim?code=${encodeURIComponent(save.data.code)}`, {
  headers: { origin: "http://localhost:5183" },
});
const claimBody = await claim.json();
test("claim is CORS-allowed and returns the quiz", () => {
  assert(claim.status === 200, "claim status: " + claim.status);
  assert(claim.headers.get("access-control-allow-origin") === "http://localhost:5183", "CORS origin missing");
  assert(claimBody.quiz?.title === "General Knowledge", "quiz title changed");
});

const second = await fetch(`http://127.0.0.1:${PORT}/api/inbox/claim?code=${encodeURIComponent(save.data.code)}`);
test("a second claim is 410 (single-use)", () => {
  assert(second.status === 410, "second status: " + second.status);
});

const invalidSave = await tool("save_quiz", { raw: "not json" });
test("save_quiz refuses invalid content with isError", () => {
  assert(invalidSave.isError === true, "invalid save was not isError");
});

test("the bundled core repairs and validates the sample directly", () => {
  const repaired = core.repairQuiz(fixture);
  assert(repaired.ok === true, "core repair failed");
  assert(core.validateQuiz(repaired.quiz).ok === true, "core validation failed");
});

server.kill("SIGTERM");
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
