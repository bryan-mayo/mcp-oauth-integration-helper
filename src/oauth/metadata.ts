import type { Express } from "express";
import { config, SCOPES } from "../config.js";

/**
 * RFC9728 protected-resource metadata + RFC8414 authorization-server metadata.
 * Served at both root and path-inserted well-known URIs for MCP client compat.
 */
export function registerMetadataRoutes(app: Express) {
  const protectedResourceDoc = () => ({
    resource: config.mcpServerUrl,
    authorization_servers: [config.issuerUrl],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Development MCP Test Server",
  });

  const authServerDoc = () => ({
    issuer: config.issuerUrl,
    authorization_endpoint: `${config.issuerUrl}/oauth/authorize`,
    token_endpoint: `${config.issuerUrl}/oauth/token`,
    registration_endpoint: `${config.issuerUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...SCOPES],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  });

  for (const p of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    app.get(p, (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(protectedResourceDoc());
    });
  }

  for (const p of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ]) {
    app.get(p, (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(authServerDoc());
    });
  }
}
