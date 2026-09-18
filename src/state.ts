import crypto from "node:crypto";

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: number;
}

export interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: number;
  used: boolean;
}

export interface TokenRecord {
  token: string;
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
  revoked: boolean;
}

export interface PendingAuth {
  tx: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: number;
}

export const SUPPORTED_SCENARIOS = [
  "normal",
  "oauth_denied",
  "oauth_error",
  "invalid_authorization_code",
  "expired_authorization_code",
  "invalid_pkce",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_rejected",
  "mcp_unauthorized",
  "mcp_forbidden",
  "mcp_initialization_failure",
  "mcp_unavailable",
  "tools_empty",
  "tools_list_failure",
  "tool_execution_failure",
  "slow_mcp",
] as const;

export type Scenario = (typeof SUPPORTED_SCENARIOS)[number];

export interface Counters {
  authorizationRequests: number;
  tokensIssued: number;
  mcpConnections: number;
  toolsListCalls: number;
  toolsCallCalls: number;
  resourcesReadCalls: number;
}

function freshCounters(): Counters {
  return {
    authorizationRequests: 0,
    tokensIssued: 0,
    mcpConnections: 0,
    toolsListCalls: 0,
    toolsCallCalls: 0,
    resourcesReadCalls: 0,
  };
}

class State {
  clients = new Map<string, OAuthClient>();
  codes = new Map<string, AuthCode>();
  accessTokens = new Map<string, TokenRecord>();
  refreshTokens = new Map<string, TokenRecord>();
  pending = new Map<string, PendingAuth>();
  counters: Counters = freshCounters();
  scenario: Scenario = "normal";

  reset() {
    this.clients.clear();
    this.codes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
    this.pending.clear();
    this.counters = freshCounters();
    this.scenario = "normal";
  }
}

export const state = new State();

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** S256 PKCE verification: BASE64URL(SHA256(verifier)) === challenge */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  const encoded = digest
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (encoded.length !== challenge.length) return false;
  return crypto.timingSafeEqual(Buffer.from(encoded), Buffer.from(challenge));
}

export function computeS256Challenge(verifier: string): string {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return digest
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
