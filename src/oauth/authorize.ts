import type { Express, Request, Response } from "express";
import { config, SCOPES } from "../config.js";
import { randomToken, state } from "../state.js";
import { log } from "../logger.js";

function isAllowedRedirectUri(uri: string, registered?: string[]): boolean {
  try {
    const u = new URL(uri);
    // Always allow loopback http(s) for local dev + Inspector (RFC8252).
    if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return true;
    if (uri === config.mockApiCallbackUrl) return true;
    const configured = new URL(config.mockApiCallbackUrl);
    if (u.origin === configured.origin) return true;
    if (registered?.includes(uri)) return true;
    return false;
  } catch {
    return false;
  }
}

function redirectWithError(res: Response, base: string, error: string, stateParam?: string) {
  const sep = base.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ error });
  if (stateParam) params.set("state", stateParam);
  res.redirect(302, `${base}${sep}${params.toString()}`);
}

function consentPage(tx: string, clientId: string, scopes: string[]): string {
  const items = scopes.map((s) => `<li>✓ ${s}</li>`).join("");
  return `<!doctype html><html><body>
<h2>Development MCP Server</h2>
<p>Application <code>${clientId}</code> wants access to:</p>
<ul><li>✓ MCP connection</li><li>✓ Test tools</li><li>✓ Test resources</li>${items}</ul>
<form method="GET" action="/oauth/authorize/approve"><input type="hidden" name="tx" value="${tx}"/><button type="submit">Authorize</button></form>
<form method="GET" action="/oauth/authorize/deny"><input type="hidden" name="tx" value="${tx}"/><button type="submit">Deny</button></form>
</body></html>`;
}

export function registerAuthorizeRoutes(app: Express) {
  // Step 1: authorization request → dev consent page (or protocol-level denial scenarios).
  app.get("/oauth/authorize", (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const clientId = q.client_id ?? "";
    const redirectUri = q.redirect_uri ?? "";
    const responseType = q.response_type ?? "code";
    const scope = q.scope ?? "mcp:tools";
    const scopes = scope.split(" ").map((s) => s.trim()).filter(Boolean);
    const challenge = q.code_challenge ?? "";
    const method = q.code_challenge_method ?? "S256";
    const resource = q.resource;
    const stateParam = q.state;

    state.counters.authorizationRequests += 1;
    log.oauth("authorization request");

    const client = state.clients.get(clientId);
    if (!client) {
      res
        .status(400)
        .send("unknown client_id: register via POST /oauth/register first, or set STATIC_OAUTH_CLIENT_ID to skip DCR");
      return;
    }
    if (responseType !== "code" || !redirectUri || !challenge || method !== "S256") {
      redirectWithError(res, redirectUri || config.mockApiCallbackUrl, "invalid_request", stateParam);
      return;
    }
    for (const s of scopes) {
      if (!(SCOPES as readonly string[]).includes(s)) {
        redirectWithError(res, redirectUri, "invalid_scope", stateParam);
        return;
      }
    }
    if (!isAllowedRedirectUri(redirectUri, client.redirectUris)) {
      res.status(400).send("redirect_uri not allowed for this client");
      return;
    }

    // Development scenarios produce real protocol behavior.
    if (state.scenario === "oauth_denied") {
      log.oauth("authorization denied by scenario");
      redirectWithError(res, redirectUri, "access_denied", stateParam);
      return;
    }
    if (state.scenario === "oauth_error") {
      redirectWithError(res, redirectUri, "server_error", stateParam);
      return;
    }

    const tx = randomToken(16);
    state.pending.set(tx, {
      tx,
      clientId,
      redirectUri,
      scopes,
      resource,
      state: stateParam,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      createdAt: Date.now(),
    });
    res.setHeader("Content-Type", "text/html");
    res.send(consentPage(tx, clientId, scopes));
  });

  const decide = (approved: boolean) => (req: Request, res: Response) => {
    const tx = String((req.query.tx as string | undefined) ?? (req.body as Record<string, unknown>)?.tx ?? "");
    const pending = state.pending.get(tx);
    if (!pending) {
      res.status(400).send("unknown or expired authorization transaction");
      return;
    }
    state.pending.delete(tx);

    if (!approved) {
      log.oauth("authorization denied by user");
      redirectWithError(res, pending.redirectUri, "access_denied", pending.state);
      return;
    }

    // Scenario: issue an immediately-expired code.
    const ttlMs =
      state.scenario === "expired_authorization_code" ? 1 : (Number(process.env.AUTH_CODE_TTL) || 600) * 1000;
    const code = randomToken(24);
    state.codes.set(code, {
      code,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      resource: pending.resource,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: Date.now() + ttlMs,
      used: false,
    });
    log.oauth("authorization granted, code issued");
    const sep = pending.redirectUri.includes("?") ? "&" : "?";
    const params = new URLSearchParams({ code });
    if (pending.state) params.set("state", pending.state);
    params.set("iss", config.issuerUrl); // RFC9207
    res.redirect(302, `${pending.redirectUri}${sep}${params.toString()}`);
  };

  app.get("/oauth/authorize/approve", decide(true));
  app.get("/oauth/authorize/deny", decide(false));
  app.post("/oauth/authorize/approve", decide(true));
  app.post("/oauth/authorize/deny", decide(false));
}
