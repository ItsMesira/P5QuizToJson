/* ============ P5 QUIZ — SHARE LINKS (gzip + base64url) ============ */
import type { Quiz } from "./types";

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out.replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function encodeQuizLink(quiz: Quiz): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(quiz));
  const gz = await gzipBytes(json);
  if (gz.length >= json.length) return `?z=${toBase64Url(json)}`;
  return `?q=${toBase64Url(gz)}`;
}

export async function decodeQuizLink(params: URLSearchParams): Promise<Quiz | null> {
  const q = params.get("q");
  const z = params.get("z");
  try {
    if (q) {
      const gz = fromBase64Url(q);
      const stream = new Blob([gz as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      return JSON.parse(new TextDecoder().decode(bytes)) as Quiz;
    }
    if (z) {
      return JSON.parse(new TextDecoder().decode(fromBase64Url(z))) as Quiz;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function fetchRemoteQuiz(url: string): Promise<Quiz> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Quiz;
}

/* generic JSON payload encode/decode (used for prompt share links) */
export async function encodePayload(obj: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  const gz = await gzipBytes(json);
  if (gz.length >= json.length) return toBase64Url(json);
  return toBase64Url(gz);
}

export async function decodePayload<T>(s: string): Promise<T | null> {
  try {
    const bytes = fromBase64Url(s);
    let data: Uint8Array;
    try {
      const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      data = bytes;
    }
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    return null;
  }
}

export function currentShareUrl(encoded: string): string {
  const base = location.href.split("#")[0].split("?")[0];
  return `${base}${encoded.startsWith("?") ? encoded : "?" + encoded}`;
}
