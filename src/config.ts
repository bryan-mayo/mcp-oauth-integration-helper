import dotenv from "dotenv";
dotenv.config();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: num("PORT", 4100),
  mcpServerUrl: process.env.MCP_SERVER_URL ?? "http://localhost:4100/mcp",
  issuerUrl: (process.env.ISSUER_URL ?? "http://localhost:4100").replace(/\/$/, ""),
  mockApiCallbackUrl:
    process.env.MOCK_API_CALLBACK_URL ??
    "http://localhost:4000/backend/webhook/mcp_servers/oauth/callback",
  frontendCallbackUrl: process.env.FRONTEND_CALLBACK_URL ?? "http://localhost:3000/mcp/callback",
  allowedOrigins: list("ALLOWED_ORIGINS", [
    "http://localhost:3000",
    "http://localhost:4000",
    "http://localhost:6274",
  ]),
  accessTokenTtl: num("ACCESS_TOKEN_TTL", 300),
  refreshTokenTtl: num("REFRESH_TOKEN_TTL", 86400),
  authCodeTtl: num("AUTH_CODE_TTL", 600),
  nodeEnv: process.env.NODE_ENV ?? "development",
};

export const SCOPES = ["mcp:tools", "test:protected"] as const;
export type Scope = (typeof SCOPES)[number];

// Optional static credentials (dev-only). Read live from process.env (not
// frozen) so tests and re-seeding observe current values.
export function getStaticBearerToken(): string {
  return (process.env.STATIC_BEARER_TOKEN ?? "").trim();
}

export function getStaticBearerScopes(): string[] {
  const raw = process.env.STATIC_BEARER_SCOPES;
  const scopes = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [...SCOPES];
  return scopes.length > 0 ? scopes : [...SCOPES];
}

export function getStaticClientId(): string {
  return (process.env.STATIC_OAUTH_CLIENT_ID ?? "").trim();
}

export function getStaticClientSecret(): string | undefined {
  const s = (process.env.STATIC_OAUTH_CLIENT_SECRET ?? "").trim();
  return s ? s : undefined;
}

export function getStaticClientRedirectUris(): string[] {
  const raw = process.env.STATIC_OAUTH_REDIRECT_URIS;
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [config.mockApiCallbackUrl];
}
