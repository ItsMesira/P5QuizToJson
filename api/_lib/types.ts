/* ============ P5 QUIZ API — MINIMAL REQUEST/RESPONSE TYPES ============ */

/* Structural subset of the Vercel Node function types — keeps the API
   free of @vercel/node's heavy (and historically vulnerable) dep chain. */

export interface ApiRequest {
  method?: string;
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string>;
  query?: Record<string, string | string[]>;
  text(): Promise<string>;
}

export interface ApiResponse {
  setHeader(name: string, value: string | string[]): unknown;
  status(code: number): { json(body: unknown): unknown };
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => void | Promise<void>;
