import { describe, expect, it } from "vitest";
import {
  app,
  authorizeCode,
  CALLBACK,
  exchangeCode,
  mcpHeaders,
  pkce,
  registerClient,
} from "./helpers.js";

describe("OAuth discovery + full flow", () => {
  it("MCP without auth returns 401 + WWW-Authenticate with resource_metadata", async () => {
    const agent = app();
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders())
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);
    expect(res.headers["www-authenticate"]).toMatch(/resource_metadata="/);
  });

  it("serves protected-resource and authorization-server metadata", async () => {
    const agent = app();
    const pr = await agent.get("/.well-known/oauth-protected-resource").expect(200);
    expect(pr.body.authorization_servers).toBeDefined();
    expect(pr.body.resource).toMatch(/\/mcp$/);
    const as = await agent.get("/.well-known/oauth-authorization-server").expect(200);
    expect(as.body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(as.body.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(as.body.registration_endpoint).toMatch(/\/oauth\/register$/);
    expect(as.body.code_challenge_methods_supported).toContain("S256");
  });

  it("authorize -> token -> MCP initialize -> tools/list -> tools/call echo", async () => {
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    expect(tok.body.access_token).toBeTruthy();
    expect(tok.body.refresh_token).toBeTruthy();
    expect(tok.body.token_type).toBe("Bearer");

    const access = tok.body.access_token as string;
    const init = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      })
      .expect(200);
    expect(JSON.stringify(init.body)).toMatch(/capabilities|serverInfo/);

    const list = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      .expect(200);
    const names = JSON.stringify(list.body);
    expect(names).toMatch(/echo/);
    expect(names).toMatch(/add/);

    const call = await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { message: "hello" } } })
      .expect(200);
    expect(JSON.stringify(call.body)).toMatch(/hello/);
  });

  it("rejects wrong PKCE verifier", async () => {
    const agent = app();
    const { challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier: "wrong-verifier" }).expect(400);
  });

  it("rejects authorization code reuse", async () => {
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(400);
  });

  it("expired access token fails MCP, refresh recovers", async () => {
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    const access = tok.body.access_token as string;
    const refresh = tok.body.refresh_token as string;

    await agent.post("/__dev/expire").send({ token: access }).expect(200);
    await agent
      .post("/mcp")
      .set(mcpHeaders(access))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);

    const ref = await agent
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId })
      .expect(200);
    const access2 = ref.body.access_token as string;
    await agent
      .post("/mcp")
      .set(mcpHeaders(access2))
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      .expect(200);
  });
});
