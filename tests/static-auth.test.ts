import { afterEach, describe, expect, it } from "vitest";
import {
  app,
  authorizeCode,
  CALLBACK,
  exchangeCode,
  mcpHeaders,
  pkce,
  registerClient,
} from "./helpers.js";

const STATIC_TOKEN = "test-static-bearer-token-0123456789abcdef";
const STATIC_CLIENT_ID = "test-static-client";
const STATIC_CLIENT_SECRET = "test-static-secret-abcdef123456";

afterEach(() => {
  delete process.env.STATIC_BEARER_TOKEN;
  delete process.env.STATIC_BEARER_SCOPES;
  delete process.env.STATIC_OAUTH_CLIENT_ID;
  delete process.env.STATIC_OAUTH_CLIENT_SECRET;
  delete process.env.STATIC_OAUTH_REDIRECT_URIS;
});

describe("static bearer token", () => {
  it("authenticates tools/list and tools/call without OAuth", async () => {
    process.env.STATIC_BEARER_TOKEN = STATIC_TOKEN;
    const agent = app();
    const list = await agent
      .post("/mcp")
      .set(mcpHeaders(STATIC_TOKEN))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
    expect(JSON.stringify(list.body)).toMatch(/echo/);

    const call = await agent
      .post("/mcp")
      .set(mcpHeaders(STATIC_TOKEN))
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add", arguments: { a: 1, b: 2 } } })
      .expect(200);
    expect(JSON.stringify(call.body)).toMatch(/3/);
  });

  it("wrong static value is rejected", async () => {
    process.env.STATIC_BEARER_TOKEN = STATIC_TOKEN;
    const agent = app();
    await agent
      .post("/mcp")
      .set(mcpHeaders("wrong-value"))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);
  });

  it("static_token_rejected blocks static but not OAuth tokens", async () => {
    process.env.STATIC_BEARER_TOKEN = STATIC_TOKEN;
    const agent = app();
    const { verifier, challenge } = pkce();
    const { clientId } = await registerClient(agent);
    const code = await authorizeCode(agent, clientId, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId, redirectUri: CALLBACK, verifier }).expect(200);
    const oauthAccess = tok.body.access_token as string;

    await agent.post("/__dev/scenario").send({ scenario: "static_token_rejected" }).expect(200);
    await agent
      .post("/mcp")
      .set(mcpHeaders(STATIC_TOKEN))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);
    await agent
      .post("/mcp")
      .set(mcpHeaders(oauthAccess))
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      .expect(200);
  });
});

describe("static OAuth client (skip DCR)", () => {
  it("confidential client completes flow without /oauth/register", async () => {
    process.env.STATIC_OAUTH_CLIENT_ID = STATIC_CLIENT_ID;
    process.env.STATIC_OAUTH_CLIENT_SECRET = STATIC_CLIENT_SECRET;
    process.env.STATIC_OAUTH_REDIRECT_URIS = CALLBACK;
    const agent = app();
    const { verifier, challenge } = pkce();

    const authRes = await agent
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: STATIC_CLIENT_ID,
        redirect_uri: CALLBACK,
        scope: "mcp:tools",
        state: "s1",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "http://localhost:4100/mcp",
      })
      .expect(200);
    const tx = /name="tx" value="([^"]+)"/.exec(authRes.text)?.[1];
    expect(tx).toBeTruthy();
    const approve = await agent.get("/oauth/authorize/approve").query({ tx }).redirects(0).expect(302);
    const code = new URL(approve.headers.location as string).searchParams.get("code");
    expect(code).toBeTruthy();

    const tok = await agent
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK,
        client_id: STATIC_CLIENT_ID,
        client_secret: STATIC_CLIENT_SECRET,
        code_verifier: verifier,
        resource: "http://localhost:4100/mcp",
      })
      .expect(200);
    expect(tok.body.token_type).toBe("Bearer");

    await agent
      .post("/mcp")
      .set(mcpHeaders(tok.body.access_token as string))
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
  });

  it("wrong static client secret is rejected", async () => {
    process.env.STATIC_OAUTH_CLIENT_ID = STATIC_CLIENT_ID;
    process.env.STATIC_OAUTH_CLIENT_SECRET = STATIC_CLIENT_SECRET;
    process.env.STATIC_OAUTH_REDIRECT_URIS = CALLBACK;
    const agent = app();
    const { verifier, challenge } = pkce();
    const code = await authorizeCode(agent, STATIC_CLIENT_ID, CALLBACK, challenge);
    await agent
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK,
        client_id: STATIC_CLIENT_ID,
        client_secret: "wrong-secret",
        code_verifier: verifier,
        resource: "http://localhost:4100/mcp",
      })
      .expect(401);
  });

  it("public static client (no secret) works with PKCE only", async () => {
    process.env.STATIC_OAUTH_CLIENT_ID = STATIC_CLIENT_ID;
    process.env.STATIC_OAUTH_REDIRECT_URIS = CALLBACK;
    const agent = app();
    const { verifier, challenge } = pkce();
    const code = await authorizeCode(agent, STATIC_CLIENT_ID, CALLBACK, challenge);
    const tok = await exchangeCode(agent, { code, clientId: STATIC_CLIENT_ID, redirectUri: CALLBACK, verifier }).expect(
      200,
    );
    expect(tok.body.access_token).toBeTruthy();
  });

  it("static client survives /__dev/reset", async () => {
    process.env.STATIC_OAUTH_CLIENT_ID = STATIC_CLIENT_ID;
    process.env.STATIC_OAUTH_REDIRECT_URIS = CALLBACK;
    const agent = app();
    await agent.post("/__dev/reset").expect(200);
    const { challenge } = pkce();
    // Would be 400 unknown client_id if reset had wiped the static client.
    await agent
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: STATIC_CLIENT_ID,
        redirect_uri: CALLBACK,
        scope: "mcp:tools",
        state: "s1",
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      .expect(200);
  });
});
