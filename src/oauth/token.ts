import type { Express, Request, Response } from "express";
import { config } from "../config.js";
import { randomToken, state, verifyPkceS256 } from "../state.js";
import { log } from "../logger.js";

function readClientAuth(req: Request, body: Record<string, unknown>): { id?: string; secret?: string } {
  const header = req.headers.authorization;
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx >= 0) return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
    } catch {
      // fall through
    }
  }
  const id = typeof body.client_id === "string" ? body.client_id : undefined;
  const secret = typeof body.client_secret === "string" ? body.client_secret : undefined;
  return { id, secret };
}

export function registerTokenRoute(app: Express) {
  app.post("/oauth/token", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grant = body.grant_type;

    if (grant === "authorization_code") {
      const code = String(body.code ?? "");
      const redirectUri = String(body.redirect_uri ?? "");
      const verifier = String(body.code_verifier ?? "");
      const resource = typeof body.resource === "string" ? body.resource : undefined;
      const { id: clientId, secret } = readClientAuth(req, body);
      const record = state.codes.get(code);

      if (state.scenario === "invalid_authorization_code" || !record || record.used) {
        res.status(400).json({ error: "invalid_grant", error_description: "invalid authorization code" });
        return;
      }
      if (Date.now() > record.expiresAt) {
        state.codes.delete(code);
        res.status(400).json({ error: "invalid_grant", error_description: "authorization code expired" });
        return;
      }
      if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
        res.status(400).json({ error: "invalid_grant", error_description: "client/redirect mismatch" });
        return;
      }
      const client = clientId ? state.clients.get(clientId) : undefined;
      if (!client) {
        res.status(400).json({ error: "invalid_client" });
        return;
      }
      if (client.clientSecret && client.clientSecret !== secret) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }
      if (resource && record.resource && resource !== record.resource) {
        res.status(400).json({ error: "invalid_target", error_description: "resource mismatch (RFC8707)" });
        return;
      }
      if (state.scenario === "invalid_pkce" || !verifier || !verifyPkceS256(verifier, record.codeChallenge)) {
        log.oauth("token exchange rejected: PKCE");
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }

      record.used = true;
      const accessTtl = config.accessTokenTtl;
      const access = randomToken();
      const refresh = randomToken();
      const now = Date.now();
      state.accessTokens.set(access, {
        token: access,
        clientId: record.clientId,
        scopes: record.scopes,
        resource: record.resource,
        expiresAt: now + accessTtl * 1000,
        revoked: false,
      });
      state.refreshTokens.set(refresh, {
        token: refresh,
        clientId: record.clientId,
        scopes: record.scopes,
        resource: record.resource,
        expiresAt: now + config.refreshTokenTtl * 1000,
        revoked: false,
      });
      state.counters.tokensIssued += 1;
      log.oauth("token exchange successful, tokens issued");
      res.json({
        access_token: access,
        refresh_token: refresh,
        expires_in: accessTtl,
        token_type: "Bearer",
        scope: record.scopes.join(" "),
      });
      return;
    }

    if (grant === "refresh_token") {
      const refresh = String(body.refresh_token ?? "");
      const { id: clientId, secret } = readClientAuth(req, body);
      const record = state.refreshTokens.get(refresh);

      if (
        state.scenario === "refresh_token_rejected" ||
        state.scenario === "refresh_token_expired" ||
        !record ||
        record.revoked ||
        Date.now() > record.expiresAt
      ) {
        res.status(400).json({ error: "invalid_grant", error_description: "refresh token rejected" });
        return;
      }
      if (clientId && record.clientId !== clientId) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      const client = state.clients.get(record.clientId);
      if (client?.clientSecret && client.clientSecret !== secret) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }

      const access = randomToken();
      state.accessTokens.set(access, {
        token: access,
        clientId: record.clientId,
        scopes: record.scopes,
        resource: record.resource,
        expiresAt: Date.now() + config.accessTokenTtl * 1000,
        revoked: false,
      });
      state.counters.tokensIssued += 1;
      log.oauth("refresh successful, new access token issued");
      res.json({
        access_token: access,
        refresh_token: refresh,
        expires_in: config.accessTokenTtl,
        token_type: "Bearer",
        scope: record.scopes.join(" "),
      });
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });
}
