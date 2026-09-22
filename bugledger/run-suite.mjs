/* ============ BUG LEDGER — SEQUENTIAL SUITE RUNNER ============
   Runs every harness sequentially (parallel puppeteer runs contend for CPU and
   contaminate timing-based assertions) and records a machine-readable result.

   Usage: node bugledger/run-suite.mjs [--out bugledger/suite-results.json] [--only a,b]
*/
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n, d = "") => {
  const i = args.indexOf(n);
  return i === -1 ? d : args[i + 1];
};
const OUT = opt("--out", "bugledger/suite-results.json");
const ONLY = opt("--only", "");
const PER_TEST_MS = Number(opt("--timeout", "240000"));

/* dev-server screens (vite :5183) then API/DB screens (devapi :3011) */
const TESTS = [
  ["smoke.mjs", {}],
  ["matrixtest.mjs", {}],
  ["reviewtest.mjs", {}],
  ["realinput.mjs", {}],
  ["menutest.mjs", {}],
  ["fixtest.mjs", {}],
  ["resumetest.mjs", {}],
  ["shuffletest.mjs", {}],
  ["repairtest.mjs", {}],
  ["stalechunktest.mjs", {}],
  ["langtest.mjs", {}],
  ["themetest.mjs", {}],
  ["uifixtest.mjs", {}],
  ["mobtest.mjs", {}],
  ["porttest.mjs", {}],
  ["buildertest.mjs", {}],
  ["csptest.mjs", {}],
  ["expltest.mjs", {}],
  ["studytest.mjs", {}],
  ["audit.mjs", {}],
  ["mobileaudit.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["perfaudit.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["authtest.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["securitytest.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["classroomtest.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["admintest.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["admine2etest.mjs", { P5Q_BASE: "http://localhost:3011" }],
  /* bug-ledger guards: the six primitives (T1-T5) and the loading/spam UX.
     Both are pre-fix falsifiable — see bugledger/LEDGER.md. */
  ["bugledger/regression.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["bugledger/loading-ux.mjs", { P5Q_BASE: "http://localhost:3011" }],
  ["bugledger/loader-mobile.mjs", {}],
].filter(([f]) => !ONLY || ONLY.split(",").some((o) => f.includes(o)));

function runOne(file, extraEnv) {
  return new Promise((resolve) => {
    if (!fileExists(file)) return resolve({ file, status: "MISSING" });
    const t0 = Date.now();
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const cap = (b) => {
      out += b.toString();
      if (out.length > 200000) out = out.slice(-200000);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ file, status: "TIMEOUT", ms: Date.now() - t0, out: out.slice(-4000) });
    }, PER_TEST_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        file,
        status: code === 0 ? "PASS" : "FAIL",
        exit: code,
        ms: Date.now() - t0,
        out: out.slice(-4000),
      });
    });
  });
}

function fileExists(f) {
  try {
    return statSync(ROOT + f).isFile();
  } catch {
    return false;
  }
}

const results = [];
for (const [file, env] of TESTS) {
  process.stdout.write(`\n=== ${file} ... `);
  const r = await runOne(file, env);
  process.stdout.write(`${r.status} (${r.ms ?? 0}ms)\n`);
  if (r.status !== "PASS") process.stdout.write((r.out ?? "").split("\n").slice(-25).join("\n") + "\n");
  results.push(r);
}

const summary = {
  at: new Date().toISOString(),
  pass: results.filter((r) => r.status === "PASS").length,
  fail: results.filter((r) => r.status === "FAIL").length,
  timeout: results.filter((r) => r.status === "TIMEOUT").length,
  missing: results.filter((r) => r.status === "MISSING").length,
  results: results.map((r) => ({ file: r.file, status: r.status, exit: r.exit, ms: r.ms, tail: r.status === "PASS" ? "" : r.out })),
};
mkdirSync(dirname(ROOT + OUT), { recursive: true });
writeFileSync(ROOT + OUT, JSON.stringify(summary, null, 2));
console.log(`\n==== SUITE: ${summary.pass} pass, ${summary.fail} fail, ${summary.timeout} timeout, ${summary.missing} missing -> ${OUT}`);
