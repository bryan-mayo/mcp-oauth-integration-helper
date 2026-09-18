import type { Express, Request, Response } from "express";
import { randomToken, state } from "../state.js";
import { log } from "../logger.js";

/** RFC7591 Dynamic Client Registration (public + confidential clients). */
export function registerRegisterRoute(app: Express) {
  app.post("/oauth/register", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris)
      ? (body.redirect_uris as unknown[]).filter((u): u is string => typeof u === "string")
      : [];

    if (redirectUris.length === 0) {
      res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uris required" });
      return;
    }

    const clientId = `dev-client-${randomToken(8)}`;
    const wantsSecret =
      body.token_endpoint_auth_method === "client_secret_post" ||
      body.token_endpoint_auth_method === "client_secret_basic" ||
      typeof body.client_secret === "string";
    const clientSecret = wantsSecret ? randomToken(24) : undefined;

    state.clients.set(clientId, {
      clientId,
      clientSecret,
      redirectUris,
      clientName: typeof body.client_name === "string" ? body.client_name : undefined,
      createdAt: Date.now(),
    });

    log.oauth("dynamic client registered");
    res.status(201).json({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: clientSecret ? "client_secret_post" : "none",
    });
  });
}
