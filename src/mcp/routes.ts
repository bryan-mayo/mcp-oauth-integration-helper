import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerAuth } from "../oauth/middleware.js";
import { buildMcpServer } from "./tools.js";
import { state } from "../state.js";
import { log } from "../logger.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonRpc(id: unknown, payload: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, ...payload };
}

/**
 * Real MCP Streamable HTTP endpoint (stateless per-request transport).
 * Auth runs first so unauthenticated clients get 401 + WWW-Authenticate.
 */
export function registerMcpRoutes(app: Express) {
  app.post("/mcp", bearerAuth(), async (req: Request, res: Response) => {
    const body = req.body as { method?: string; id?: unknown; params?: unknown } | undefined;

    if (state.scenario === "mcp_unavailable") {
      res.status(503).json({ error: "simulated MCP unavailable" });
      return;
    }
    if (state.scenario === "slow_mcp") {
      await delay(3000);
    }

    // Protocol-level failure injection before the SDK transport.
    if (body?.method === "initialize" && state.scenario === "mcp_initialization_failure") {
      log.mcp("initialize (simulated failure)");
      res.json(jsonRpc(body.id ?? null, { error: { code: -32603, message: "Simulated initialization failure" } }));
      return;
    }
    if (body?.method === "tools/list") {
      state.counters.toolsListCalls += 1;
      if (state.scenario === "tools_empty") {
        log.mcp("tools/list (simulated empty)");
        res.json(jsonRpc(body.id ?? null, { result: { tools: [] } }));
        return;
      }
      if (state.scenario === "tools_list_failure") {
        log.mcp("tools/list (simulated failure)");
        res.json(jsonRpc(body.id ?? null, { error: { code: -32603, message: "Simulated tools/list failure" } }));
        return;
      }
    }
    if (body?.method === "tools/call") state.counters.toolsCallCalls += 1;
    if (body?.method === "initialize") {
      state.counters.mcpConnections += 1;
      log.mcp("initialize");
    } else {
      log.mcp(String(body?.method ?? "mcp request"));
    }

    try {
      const server = buildMcpServer(req.devAuth);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.warn(`MCP handler error: ${(err as Error).message}`);
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    }
  });

  // Stateless server: no standalone GET stream / DELETE session.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "method_not_allowed", hint: "POST JSON-RPC to /mcp" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
}
