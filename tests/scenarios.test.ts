import { describe, expect, it } from "vitest";
import { app, authorizeCode, CALLBACK, exchangeCode, mcpHeaders, pkce, registerClient } from "./helpers.js";

describe("scenarios + reset", () => {
  it("mcp_unauthorized forces 401; reset restores", async () => {
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);

    await agent.post("/__dev/scenario").send({ scenario: "mcp_unauthorized" }).expect(200);
    await agent
      .post("/mcp")
      .set(mcpHeaders(tok.body.access_token as string))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);

    await agent.post("/__dev/reset").expect(200);
    // tokens wiped by reset → still 401 but scenario is normal again
    const s = await agent.get("/__dev/scenario").expect(200);
    expect(s.body.scenario).toBe("normal");
  });

  it("tools_empty returns empty list", async () => {
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    await agent.post("/__dev/scenario").send({ scenario: "tools_empty" }).expect(200);
    const res = await agent
      .post("/mcp")
      .set(mcpHeaders(tok.body.access_token as string))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
    expect(JSON.stringify(res.body)).toMatch(/"tools":\[\]/);
  });

  it("token_expired forces 401 on valid token", async () => {
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    await agent.post("/__dev/scenario").send({ scenario: "token_expired" }).expect(200);
    await agent
      .post("/mcp")
      .set(mcpHeaders(tok.body.access_token as string))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);
  });

  it("rejects unknown scenario", async () => {
    const agent = app();
    await agent.post("/__dev/scenario").send({ scenario: "nope" }).expect(400);
  });
});
