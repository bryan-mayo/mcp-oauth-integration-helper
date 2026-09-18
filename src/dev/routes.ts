import type { Express, Request, Response } from "express";
import { config } from "../config.js";
import { SUPPORTED_SCENARIOS, state, type Scenario } from "../state.js";
import { log } from "../logger.js";

export function registerDevRoutes(app: Express) {
  app.post("/__dev/scenario", (req: Request, res: Response) => {
    const scenario = (req.body as Record<string, unknown>)?.scenario as string | undefined;
    if (!scenario || !(SUPPORTED_SCENARIOS as readonly string[]).includes(scenario)) {
      res.status(400).json({ error: "unknown_scenario", supported: SUPPORTED_SCENARIOS });
      return;
    }
    state.scenario = scenario as Scenario;
    log.dev(`scenario set: ${scenario}`);
    res.json({ scenario: state.scenario });
  });

  app.get("/__dev/scenario", (_req, res) => res.json({ scenario: state.scenario }));

  app.post("/__dev/reset", (_req, res) => {
    state.reset();
    log.dev("state reset");
    res.json({ ok: true, scenario: state.scenario });
  });

  // Test helper: force-expire a token (or all access tokens) without a custom API on the MCP path.
  app.post("/__dev/expire", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : undefined;
    if (token) {
      const rec = state.accessTokens.get(token);
      if (rec) rec.expiresAt = Date.now() - 1;
      res.json({ ok: true });
      return;
    }
    for (const rec of state.accessTokens.values()) rec.expiresAt = Date.now() - 1;
    log.dev("all access tokens expired");
    res.json({ ok: true });
  });

  app.get("/__dev/state", (_req, res) => {
    res.json({
      scenario: state.scenario,
      counters: state.counters,
      clients: state.clients.size,
      pendingAuths: state.pending.size,
    });
  });

  app.get("/__dev", (_req, res) => {
    const c = state.counters;
    res.setHeader("Content-Type", "text/html");
    res.send(`<!doctype html><html><body>
<h2>MCP Test Server (development only)</h2>
<p>Current scenario: <strong>${state.scenario}</strong></p>
<form method="POST" action="/__dev/scenario">
<select name="scenario">${SUPPORTED_SCENARIOS.map((s) => `<option ${s === state.scenario ? "selected" : ""}>${s}</option>`).join("")}</select>
<button type="submit">Set</button></form>
<h3>OAuth</h3><p>Authorization requests: ${c.authorizationRequests}<br/>Tokens issued: ${c.tokensIssued}</p>
<h3>MCP</h3><p>Connections: ${c.mcpConnections}<br/>tools/list: ${c.toolsListCalls}<br/>tools/call: ${c.toolsCallCalls}</p>
<form method="POST" action="/__dev/reset"><button type="submit">Reset State</button></form>
<p>MCP: ${config.mcpServerUrl} · Issuer: ${config.issuerUrl}</p>
</body></html>`);
  });
}
