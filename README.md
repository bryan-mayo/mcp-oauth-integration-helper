# MCP + OAuth Test Server

Standalone development application that behaves like a real external MCP server
with OAuth authentication. Real MCP transport, real OAuth discovery, real
authorization codes, real PKCE, real bearer validation, real refresh flow.
Fake users, fake tools, fake business data, configurable failures.

Use it to integration-test the existing Mock API + frontend stack:

```text
Frontend --REST--> Mock API --MCP/OAuth--> THIS SERVER (localhost:4100)
```

## 1. Files created (repo root)

```text
package.json tsconfig.json .env.example .gitignore
src/index.ts src/app.ts src/config.ts src/logger.ts src/state.ts
src/oauth/metadata.ts src/oauth/register.ts src/oauth/authorize.ts
src/oauth/token.ts src/oauth/middleware.ts
src/mcp/tools.ts src/mcp/routes.ts
src/dev/routes.ts
tests/helpers.ts tests/oauth.test.ts tests/tools.test.ts tests/scenarios.test.ts
```

## 2. Dependencies added

Runtime: `@modelcontextprotocol/sdk`, `express`, `cors`, `dotenv`, `zod`.
Dev: `typescript`, `tsx`, `vitest`, `supertest`, `@types/*`.

## 3. MCP SDK / version used

`@modelcontextprotocol/sdk@^1.30.0` (1.x line), protocol `2025-06-18`,
`McpServer` + `StreamableHTTPServerTransport` in stateless JSON mode
(`sessionIdGenerator: undefined, enableJsonResponse: true`). Pinned to 1.x
because it implements the `initialize` handshake most existing clients
(including MCP Inspector classic) expect. SDK 2.x removes `initialize`.

## 4. MCP endpoint

```text
POST http://localhost:4100/mcp
```

Unauthenticated requests get `401 + WWW-Authenticate: Bearer
resource_metadata=".../.well-known/oauth-protected-resource"`.
`GET/DELETE /mcp` return `405` (stateless server, no SSE stream to resume).

Three credential modes (independent, can coexist):

| Mock API field | Server side | Flow |
| --- | --- | --- |
| `token` | `STATIC_BEARER_TOKEN` env | Static bearer, accepted as-is. Never expires, no refresh. |
| `oauth_client_id` empty | Automatic | Mock API calls `POST /oauth/register` (DCR) during `oauth/start`. |
| `oauth_client_id` (+`secret`) set | `STATIC_OAUTH_CLIENT_ID` (+`SECRET`) env | Skip-DCR: pre-provisioned client, full authorize/PKCE/token flow without any register call. |

The static bearer token is checked before the OAuth token store (timing-safe
compare); scenario-forced `mcp_unauthorized`/`mcp_forbidden` still win over both.

## 5. OAuth discovery endpoints

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp   (path-inserted fallback)
GET /.well-known/oauth-authorization-server
GET /.well-known/openid-configuration           (compat alias)
POST /oauth/register                            (RFC7591 dynamic client registration)
```

## 6. Authorization endpoint

```text
GET /oauth/authorize
GET /oauth/authorize/approve?tx=...   (dev consent page button)
GET /oauth/authorize/deny?tx=...
```

Renders a dev consent page (`Authorize` / `Deny`). The `client_id` must have
been registered via `POST /oauth/register` **or** pre-provisioned with
`STATIC_OAUTH_CLIENT_ID` (skip-DCR). Approve issues a random,
short-lived, single-use code bound to `{client, redirect_uri, scopes,
resource, PKCE challenge}` and redirects to the client's `redirect_uri` with
`?code=...&state=...&iss=...` (RFC9207). Deny redirects with
`?error=access_denied&state=...`. Loopback `redirect_uris`, the
`MOCK_API_CALLBACK_URL` origin, and DCR-registered URIs are accepted.

## 7. Token endpoint

```text
POST /oauth/token   (form-encoded; authorization_code + refresh_token grants)
```

Validates code (single-use, expiry, client/redirect match, RFC8707 resource
match), verifies `S256` PKCE, enforces confidential-client secrets, returns
`{access_token, refresh_token, expires_in, token_type: "Bearer", scope}`.

## 8. Available MCP tools / resources

| Tool | Input | Behaviour |
| --- | --- | --- |
| `echo` | `{message}` | returns message |
| `add` | `{a, b}` | returns `a+b` (`10+20 → 30`) |
| `get_current_user` | — | `{id: "dev-user", name, scopes}` (never tokens) |
| `slow_response` | `{seconds ≤ 30}` | waits, then returns |
| `throw_error` | — | MCP tool error (`isError: true`) |
| `protected_echo` | `{message}` | requires `test:protected`, else `insufficient_scope` tool error |

Resource: `test://server/info → {name: "Development MCP Test Server",
environment: "development"}` via `resources/list` + `resources/read`.

## 9. Supported OAuth scopes

`mcp:tools` (default), `test:protected` (for `protected_echo` /
insufficient-scope testing).

## 10. Development scenarios

```bash
POST /__dev/scenario   {"scenario": "<name>"}
GET  /__dev/scenario
```

`normal`, `oauth_denied`, `oauth_error`, `invalid_authorization_code`,
`expired_authorization_code`, `invalid_pkce`, `token_expired`,
`refresh_token_expired`, `refresh_token_rejected`, `static_token_rejected`,
`mcp_unauthorized`, `mcp_forbidden`, `mcp_initialization_failure`, `mcp_unavailable`,
`tools_empty`, `tools_list_failure`, `tool_execution_failure`, `slow_mcp`.
Each produces real protocol behaviour (real 401/403/503, real JSON-RPC
errors, real `invalid_grant`), not a custom error API. Dashboard: `GET /__dev`.

## 11. Environment variables

See `.env.example`. `PORT` (4100), `MCP_SERVER_URL`, `ISSUER_URL`,
`MOCK_API_CALLBACK_URL` (backend OAuth callback, e.g.
`http://localhost:4000/backend/webhook/mcp_servers/oauth/callback`),
`ALLOWED_ORIGINS` (explicit CORS list), `FRONTEND_CALLBACK_URL`
(`http://localhost:3000/mcp/callback`), `ACCESS_TOKEN_TTL` (set `10` to test
refresh), `REFRESH_TOKEN_TTL`, `AUTH_CODE_TTL`.

Static auth (both optional, dev-only, empty = disabled):

```env
STATIC_BEARER_TOKEN=<hex>                  # Mock API `token` field value
STATIC_BEARER_SCOPES=mcp:tools test:protected
STATIC_OAUTH_CLIENT_ID=dev-static-client   # Mock API `oauth_client_id` value
STATIC_OAUTH_CLIENT_SECRET=                # empty = public client (PKCE only)
STATIC_OAUTH_REDIRECT_URIS=                # default: MOCK_API_CALLBACK_URL
```

`GET /__dev/state` reports which modes are active under `authModes`.

## 12. How to start the server

```bash
npm install
cp .env.example .env   # adjust ports/URLs
npm run dev            # or: npm run build && npm start
npm test               # 22 HTTP integration tests
```

## 13. How to configure the existing Mock API to connect to it

1. In the Mock API, create an MCP server with endpoint
   `http://localhost:4100/mcp`.
2. **Heads-up — `MCP v1.1.md` requires `https` + public host and rejects
   `localhost`.** For local dev either add a bypass (e.g.
   `ALLOW_PRIVATE_ENDPOINTS=true` in the Mock API validator) or expose this
   server via an `https` tunnel and set `MCP_SERVER_URL`/`ISSUER_URL` to the
   tunnel URL.
3. Leave `oauth_client_id/secret` empty so the Mock API uses dynamic client
   registration (`POST /oauth/register`); or pre-register and paste the id.
   To skip DCR with stable values, set `STATIC_OAUTH_CLIENT_ID` (+ optional
   `STATIC_OAUTH_CLIENT_SECRET`) here and paste the same values into the
   Mock API's `oauth_client_id`/`oauth_client_secret` fields — no register
   call needed.
4. Set this server's `MOCK_API_CALLBACK_URL` to the exact `redirect_uri` the
   Mock API sends (the value returned by `POST /mcp_servers/{id}/oauth/start`).
5. To test the static-token path instead of OAuth, set `STATIC_BEARER_TOKEN`
   here and paste the same value into the Mock API's `token` field — MCP
   calls then authenticate without any OAuth flow.

## 14. How to run the complete OAuth popup flow from the frontend

1. `POST /mcp_servers` (or reuse a server), then
   `POST /mcp_servers/{id}/oauth/start` → `{authorization_url, redirect_uri}`.
2. Open `authorization_url` in a popup → dev consent page → `Authorize`.
3. This server redirects to the Mock API backend callback with
   `?code=...&state=...&iss=...`.
4. Mock API exchanges the code at `/oauth/token`, stores tokens, redirects the
   popup to `/mcp/callback?status=success` (or `?status=error&reason=...`).
5. `/mcp/callback` `postMessage`s the opener, then calls
   `POST /mcp_servers/{id}/resync` to re-run `tools/list`.

## 15. How to test the server independently with MCP Inspector

Point Inspector at `http://localhost:4100/mcp`, complete OAuth (use a
`http://localhost:*` redirect), then run `initialize`, `tools/list`,
`tools/call` (`echo`, `add`, `throw_error`), and read
`test://server/info`. If Inspector works but the Mock API doesn't, the bug is
in the Mock API client; if both fail, investigate this server.

## 16. How to reset development state

```bash
POST /__dev/reset    # clears clients/codes/tokens/scenario/counters
POST /__dev/expire   # expire one/all access tokens: {"token": "..."} or {}
```

## 17. Known limitations

* In-memory state only; restart or `/__dev/reset` wipes everything — except
  the static OAuth client, which is re-seeded from env on reset. DCR
  registrations are lost on reset/restart.
* Static bearer token never expires and cannot be refreshed (use
  `static_token_rejected` to simulate failure).
* Single fake user (`dev-user`); no real accounts, no login.
* Opaque dev tokens (no JWT/introspection endpoint).
* Stateless MCP transport: no SSE push, no resumable streams, no
  `Mcp-Session-Id` sessions.
* `http://localhost` defaults: production deployments need real `https`
  issuer URLs and a strict redirect allowlist.
* Logs redact secrets but the consent/token endpoints are still dev-grade —
  never expose this server publicly.
