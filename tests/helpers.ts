import crypto from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { state } from "../src/state.js";

export const CALLBACK = "http://localhost:4000/backend/webhook/mcp_servers/oauth/callback";

export function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function app() {
  state.reset();
  return request(createApp());
}

type Agent = ReturnType<typeof app>;

export async function registerClient(agent: Agent, redirectUri = CALLBACK) {
  const res = await agent
    .post("/oauth/register")
    .send({ redirect_uris: [redirectUri], client_name: "test", grant_types: ["authorization_code", "refresh_token"] })
    .expect(201);
  return { clientId: res.body.client_id as string, redirectUri };
}

export async function authorizeCode(
  agent: Agent,
  clientId: string,
  redirectUri: string,
  challenge: string,
  scope = "mcp:tools",
) {
  const authRes = await agent
    .get("/oauth/authorize")
    .query({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "http://localhost:4100/mcp",
    })
    .expect(200);
  const tx = /name="tx" value="([^"]+)"/.exec(authRes.text)?.[1];
  if (!tx) throw new Error("tx not found in consent page");
  const approve = await agent.get("/oauth/authorize/approve").query({ tx }).redirects(0).expect(302);
  const location = approve.headers.location as string;
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`no code in redirect: ${location}`);
  return code;
}

export function exchangeCode(
  agent: Agent,
  opts: { code: string; clientId: string; redirectUri: string; verifier: string },
) {
  return agent.post("/oauth/token").type("form").send({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
    resource: "http://localhost:4100/mcp",
  });
}

export function mcpHeaders(token?: string) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
