import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DevAuthInfo } from "../oauth/middleware.js";
import { state } from "../state.js";
import { log } from "../logger.js";

const MAX_SLOW_SECONDS = 30;

function checkToolScope(auth: DevAuthInfo | undefined, scope: string): void {
  if (!auth?.scopes.includes(scope)) {
    throw new Error(`insufficient_scope: requires ${scope}`);
  }
}

export function buildMcpServer(auth?: DevAuthInfo): McpServer {
  const server = new McpServer({ name: "mcp-oauth-simulator", version: "0.1.0" });

  server.tool("echo", "Echo a message back", { message: z.string() }, async ({ message }) => {
    if (state.scenario === "tool_execution_failure") {
      return { content: [{ type: "text", text: "Simulated tool failure (tool_execution_failure)" }], isError: true };
    }
    log.mcp("tools/call echo");
    return { content: [{ type: "text", text: message }] };
  });

  server.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => {
    if (state.scenario === "tool_execution_failure") {
      return { content: [{ type: "text", text: "Simulated tool failure" }], isError: true };
    }
    log.mcp("tools/call add");
    return { content: [{ type: "text", text: String(a + b) }] };
  });

  server.tool("get_current_user", "Development user info (never returns tokens)", {}, async () => {
    log.mcp("tools/call get_current_user");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ id: "dev-user", name: "Development User", scopes: auth?.scopes ?? [] }),
        },
      ],
    };
  });

  server.tool(
    "slow_response",
    "Wait N seconds before returning (max 30)",
    { seconds: z.number().min(0).max(MAX_SLOW_SECONDS).default(5) },
    async ({ seconds }) => {
      log.mcp("tools/call slow_response");
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return { content: [{ type: "text", text: `waited ${seconds}s` }] };
    },
  );

  server.tool("throw_error", "Always returns an MCP tool error", {}, async () => {
    log.mcp("tools/call throw_error");
    return { content: [{ type: "text", text: "Simulated tool error (throw_error)" }], isError: true };
  });

  server.tool(
    "protected_echo",
    "Echo requiring scope test:protected",
    { message: z.string() },
    async ({ message }) => {
      try {
        checkToolScope(auth, "test:protected");
      } catch {
        log.mcp("tools/call protected_echo insufficient_scope");
        return {
          content: [{ type: "text", text: "insufficient_scope: requires test:protected" }],
          isError: true,
        };
      }
      if (state.scenario === "tool_execution_failure") {
        return { content: [{ type: "text", text: "Simulated tool failure" }], isError: true };
      }
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.resource("server-info", "test://server/info", async (uri) => {
    state.counters.resourcesReadCalls += 1;
    log.mcp("resources/read test://server/info");
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ name: "Development MCP Test Server", environment: "development" }),
        },
      ],
    };
  });

  return server;
}
