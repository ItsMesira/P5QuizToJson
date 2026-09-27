/* ============ P5 QUIZ — E2E SHARED HELPERS ============ */
/* Standalone (no test-runner) helpers for the classroom API suite and the
   browser smoke: cookie-jar Client with rotating x-forwarded-for, PASS/FAIL
   check() with a shared failure counter, throwaway-fixture + cleanup helpers,
   and the system-Chrome Playwright bootstrap. */

import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { existsSync } from "node:fs";

export const BASE = (process.env.P5Q_BASE ?? "http://localhost:3011").replace(/\/+$/, "");
export const PASSWORD = "Gauntlet123";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Shared tally so every script can print one summary and exit non-zero. */
export const results = { passes: 0, fails: 0 };
export function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (ok) results.passes++;
  else results.fails++;
  return !!ok;
}

/* A fresh test-net IP per call: the API rate-limits per x-forwarded-for, and
   seeding/manipulation must never trip a limiter. */
export function randIp() {
  const b = randomBytes(3);
  return `10.${b[0] || 1}.${b[1] || 1}.${b[2] || 1}`;
}

/* Cookie-jar client. Mirrors admine2etest.mjs: JSON + CSRF header + xff. */
export class Client {
  constructor(base = BASE) {
    this.base = base;
    this.cookies = {};
    this.xff = randIp();
  }
  header() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  csrf() {
    return this.cookies.p5q_csrf ? decodeURIComponent(this.cookies.p5q_csrf) : "";
  }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (!list.length) {
      const raw = res.headers.get("set-cookie");
      if (raw) list.push(raw);
    }
    for (const c of list) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  }
  async req(method, path, body, { ip } = {}) {
    const headers = {
      "Content-Type": "application/json",
      cookie: this.header(),
      "x-forwarded-for": ip ?? this.xff,
    };
    if (this.csrf()) headers["x-csrf-token"] = this.csrf();
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.absorb(res);
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* empty / non-JSON body */
    }
    return { status: res.status, json };
  }
  get(path, opts) {
    return this.req("GET", path, undefined, opts);
  }
  post(path, body, opts) {
    return this.req("POST", path, body, opts);
  }
  patch(path, body, opts) {
    return this.req("PATCH", path, body, opts);
  }
  del(path, opts) {
    return this.req("DELETE", path, undefined, opts);
  }
}

/* A real, valid quiz payload (the shape the loader/API accept). */
export function validQuiz(title) {
  return {
    title,
    sections: [
      {
        name: "S1",
        questions: [
          {
            type: "multiple",
            question: "What is 2 + 2?",
            answers: [{ text: "4", correct: true }, { text: "5" }],
          },
        ],
      },
    ],
  };
}

/* ---------- fixtures ---------- */

export function registerUser(client, username, password = PASSWORD) {
  return client.post("/api/auth/register", { username, password });
}

export function createClass(client, name) {
  return client.post("/api/classes/create", { name });
}

export function joinClass(client, code) {
  return client.post("/api/classes/join", { code });
}

/* POST one quiz per title, rotating the source IP so the 20/min limiter is
   never the reason a seed fails. Returns ids + statuses in input order. */
export async function seedQuizzes(client, classId, titles) {
  const ids = [];
  const statuses = [];
  for (const title of titles) {
    const res = await client.post(
      `/api/classes/${classId}/quizzes`,
      { title, quiz: validQuiz(title) },
      { ip: randIp() },
    );
    statuses.push(res.status);
    ids.push(res.json?.id ?? null);
  }
  return { ids, statuses };
}

/* ---------- cleanup ---------- */
/* Deleting the owner cascades classes/quizzes/results/members, so one
   DELETE /api/auth/me per registered account removes the whole fixture. */

export async function deleteAccount(client) {
  return client.del("/api/auth/me");
}

export async function cleanupAccounts(accounts) {
  for (const a of accounts) {
    if (!a?.client || !a?.created) continue;
    try {
      const r = await deleteAccount(a.client);
      check(`cleanup: ${a.name} deleted (DELETE /api/auth/me)`, r.status === 200 && r.json?.ok === true, `status=${r.status}`);
      const after = await a.client.get("/api/auth/me");
      check(`cleanup: ${a.name} session gone after delete`, after.status === 401, `status=${after.status}`);
    } catch (e) {
      check(`cleanup: ${a.name} deleted`, false, String(e).slice(0, 160));
    }
  }
}

/* ---------- browser ---------- */
/* Prefer Chrome for Testing (stable branded Chrome on this host silently dies
   ~30s into a session); fall back to the installed channel if it is missing. */
const CFT_DEFAULT =
  process.env.P5Q_CHROME ??
  "/Users/blue/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
export function browser() {
  return existsSync(CFT_DEFAULT)
    ? chromium.launch({ executablePath: CFT_DEFAULT, headless: true })
    : chromium.launch({ channel: "chrome", headless: true });
}
