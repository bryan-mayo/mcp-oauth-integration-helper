import { describe, expect, it } from "vitest";
import { app, authorizeCode, CALLBACK, exchangeCode, mcpHeaders, pkce, registerClient } from "./helpers.js";

async function authed() {
  const agent = app();
  const { verifier, challenge } = pkce();
  const { clientId } = await registerClient(agent);
  const code = await authorizeCode(agent, clientId, CALLBACK, challenge, "mcp:tools test:protected");
  const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
  return { agent, access: tok.body.access_token as string };
}

describe("MCP tools", () => {
  it("add returns 30", async () => {
    const { agent, access } = await authed();
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add", arguments: { a: 10, b: 20 } } })
      .expect(200);
    expect(JSON.stringify(res.body)).toMatch(/30/);
  });

  it("get_current_user never returns tokens", async () => {
    const { agent, access } = await authed();
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_current_user", arguments: {} } })
      .expect(200);
    const text = JSON.stringify(res.body);
    expect(text).toMatch(/dev-user/);
    expect(text).not.toMatch(/refresh_token/);
  });

  it("throw_error returns tool error", async () => {
    const { agent, access } = await authed();
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "throw_error", arguments: {} } })
      .expect(200);
    expect(JSON.stringify(res.body)).toMatch(/isError|Simulated tool error/);
  });

  it("protected_echo enforces test:protected scope", async () => {
    // Token WITHOUT the protected scope
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge, "mcp:tools");
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders(tok.body.access_token as string))
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "protected_echo", arguments: { message: "hi" } },
      })
      .expect(200);
    expect(JSON.stringify(res.body)).toMatch(/insufficient_scope/);
  });

  it("reads test://server/info resource", async () => {
    const { agent, access } = await authed();
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "test://server/info" },
      })
      .expect(200);
    expect(JSON.stringify(res.body)).toMatch(/Development MCP Test Server/);
  });
});
