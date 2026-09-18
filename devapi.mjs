/* ============ P5 QUIZ — LOCAL API HOST (dev tool) ============ */
/* Runs the real api/ handlers + the built app from dist/ on one origin, so the
   classroom test suite can run without the Vercel CLI or a Vercel login.

   Usage:  node devapi.mjs [port]        (default 3011)
   Needs:  DATABASE_URL in the environment or .env, plus `npm run build` once. */
import { build } from "esbuild";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 3011);

/* ---------- .env loader (no dependency) ---------- */
try {
  const env = await readFile(join(root, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env — rely on the environment */
}

/* ---------- bundle api/ handlers (esbuild handles extensionless TS imports) ---------- */
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "_lib") out.push(...(await walk(p)));
    } else if (e.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const apiDir = join(root, "api");
const files = await walk(apiDir);
const routes = files.map((f) => ({ key: f.slice(apiDir.length + 1).replace(/\.ts$/, "").replace(/\/index$/, ""), file: f })).filter((r) => r.key.length > 0);
const lines = routes.map((r, i) => `export const h${i} = (await import(${JSON.stringify(r.file)})).default;`);
lines.push(`export const routes = { ${routes.map((r, i) => `${JSON.stringify(r.key)}: h${i}`).join(", ")} };`);

const outdir = join(root, "node_modules", ".p5q-devapi");
await build({
  stdin: { contents: lines.join("\n"), resolveDir: root, loader: "ts" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir,
  external: ["pg", "@node-rs/argon2"],
  logLevel: "silent",
});

const { routes: handlers } = await import(pathToFileURL(join(outdir, "stdin.js")).href);
console.log(`[devapi] ${Object.keys(handlers).length} API routes bundled`);

/* ---------- helpers ---------- */
function matchRoute(pathname) {
  const segs = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const tryKeys = (paramOk) => {
    for (const [key, fn] of Object.entries(handlers)) {
      const ksegs = key.split("/");
      if (ksegs.length !== segs.length) continue;
      const query = {};
      let ok = true;
      ksegs.forEach((ks, i) => {
        if (ks.startsWith("[") && ks.endsWith("]")) {
          if (!paramOk) { ok = false; return; }
          query[ks.slice(1, -1)] = decodeURIComponent(segs[i]);
        } else if (ks !== segs[i]) ok = false;
      });
      if (ok) return { fn, query };
    }
    return null;
  };
  return tryKeys(false) ?? tryKeys(true);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const dist = join(root, "dist");

/* abort-safe streaming: client aborts (media seeks) must never crash the host */
function pipeFile(file, opts, res) {
  const stream = createReadStream(file, opts);
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

async function sendFile(req, res, file) {
  try {
    const s = await stat(file);
    if (!s.isFile()) return false;
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" };
    const range = req.headers.range;
    const m = typeof range === "string" ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : s.size - 1;
      if (Number.isFinite(start) && start <= end && end < s.size) {
        res.writeHead(206, { ...base, "content-range": `bytes ${start}-${end}/${s.size}`, "content-length": end - start + 1 });
        pipeFile(file, { start, end }, res);
        return true;
      }
    }
    res.writeHead(200, { ...base, "content-length": s.size });
    pipeFile(file, {}, res);
    return true;
  } catch {
    return false;
  }
}

/* ---------- server ---------- */
const server = createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    const route = matchRoute(url.pathname);
    if (!route) {
      nodeRes.writeHead(404, { "content-type": "application/json" });
      nodeRes.end(JSON.stringify({ ok: false, error: "No such API route" }));
      return;
    }
    for (const [k, v] of url.searchParams) route.query[k] = v;

    const chunks = [];
    for await (const c of nodeReq) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");

    const req = {
      method: nodeReq.method,
      headers: nodeReq.headers,
      query: route.query,
      text: async () => raw,
    };
    let code = 200;
    const headers = {};
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      status(c) {
        code = c;
        return {
          json(body) {
            if (!headers["content-type"]) headers["content-type"] = "application/json; charset=utf-8";
            nodeRes.writeHead(code, headers);
            nodeRes.end(typeof body === "string" ? body : JSON.stringify(body));
          },
        };
      },
    };
    try {
      await route.fn(req, res);
    } catch (err) {
      console.error("[devapi] handler crashed:", err);
      nodeRes.writeHead(500, { "content-type": "application/json" });
      nodeRes.end(JSON.stringify({ ok: false, error: "Server error" }));
    }
    return;
  }

  /* static app from dist/ with SPA fallback */
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(dist, decodeURIComponent(rel));
  if (file.startsWith(dist) && (await sendFile(nodeReq, nodeRes, file))) return;
  if (await sendFile(nodeReq, nodeRes, join(dist, "index.html"))) return;
  nodeRes.writeHead(404, { "content-type": "text/plain" });
  nodeRes.end("dist/ not found — run `npm run build` first");
});

server.listen(PORT, () => {
  console.log(`[devapi] app + API on http://localhost:${PORT}  (DATABASE_URL ${process.env.DATABASE_URL ? "set" : "MISSING"})`);
});
