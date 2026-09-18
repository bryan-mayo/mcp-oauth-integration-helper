import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { state } from "../state.js";
import { log } from "../logger.js";

export interface DevAuthInfo {
  clientId: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      devAuth?: DevAuthInfo;
    }
  }
}

export function resourceMetadataUrl(): string {
  return `${config.issuerUrl}/.well-known/oauth-protected-resource`;
}

function challenge(
  res: Response,
  status: number,
  params: { error?: string; description?: string; scope?: string } = {},
): void {
  let header = `Bearer resource_metadata="${resourceMetadataUrl()}"`;
  if (params.scope) header += `, scope="${params.scope}"`;
  if (params.error) header += `, error="${params.error}"`;
  if (params.description) header += `, error_description="${params.description}"`;
  res.setHeader("WWW-Authenticate", header);
  res.status(status).json({ error: params.error ?? "unauthorized" });
}

/** Bearer validation for the MCP resource server (RFC6750 / RFC9728). */
export function bearerAuth(requiredScopes: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (state.scenario === "mcp_unauthorized") {
      log.mcp("unauthenticated request (scenario)");
      challenge(res, 401, { error: "invalid_token", description: "simulated unauthorized", scope: "mcp:tools" });
      return;
    }
    if (state.scenario === "mcp_forbidden") {
      challenge(res, 403, {
        error: "insufficient_scope",
        scope: "mcp:tools",
        description: "simulated forbidden",
      });
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      log.mcp("unauthenticated request");
      challenge(res, 401, { error: "invalid_token", scope: "mcp:tools" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    const record = state.accessTokens.get(token);

    const expired =
      !record || record.revoked || Date.now() > record.expiresAt || state.scenario === "token_expired";
    if (expired) {
      log.mcp("authentication failure: invalid or expired token");
      challenge(res, 401, { error: "invalid_token", description: "token expired or invalid" });
      return;
    }
    // RFC8707 audience check: token must be for this MCP server when bound.
    if (record.resource && record.resource !== config.mcpServerUrl) {
      challenge(res, 401, { error: "invalid_token", description: "token audience mismatch" });
      return;
    }
    for (const s of requiredScopes) {
      if (!record.scopes.includes(s)) {
        challenge(res, 403, {
          error: "insufficient_scope",
          scope: requiredScopes.join(" "),
          description: "insufficient scope",
        });
        return;
      }
    }

    req.devAuth = { clientId: record.clientId, scopes: record.scopes };
    log.mcp("authenticated: dev-user");
    next();
  };
}
