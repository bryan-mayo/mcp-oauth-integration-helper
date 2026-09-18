// Development logger. NEVER log tokens, codes, or PKCE verifiers.
const SENSITIVE = /token|code|verifier|secret|challenge/i;

export function redact(value: unknown): string {
  if (typeof value === "string" && value.length > 12) return `${value.slice(0, 4)}…redacted`;
  return "[redacted]";
}

export const log = {
  oauth: (msg: string, ...args: unknown[]) => console.log(`[OAuth] ${msg}`, ...args),
  mcp: (msg: string, ...args: unknown[]) => console.log(`[MCP] ${msg}`, ...args),
  dev: (msg: string, ...args: unknown[]) => console.log(`[DEV] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN] ${msg}`, ...args),
};

export function safeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SENSITIVE.test(k) ? redact(v) : v;
  }
  return out;
}
