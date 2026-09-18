# MCP

# MCP servers: API reference for frontend

This document describes the MCP server API. It covers changes from  onward.

Each change is marked **NEW** or **CHANGED**.

---

## 1. MCP server management — `/mcp_servers`

This section covers create, read, update, and delete for MCP servers.

Each server belongs to one user. The user is identified by email. A user cannot see or change another user's servers.

---

### `POST /mcp_servers` — create a server

Send this request to create a server:

```
// request
{
  "name": "My Tool Server",
  "endpoint": "https://example.com/mcp",   // must be https + a public routable host
  "token": "optional-bearer-token",         // write-only, never returned
  "oauth_client_id": "optional",            // set this to skip dynamic client registration
  "oauth_client_secret": "optional",        // write-only
  "oauth_scope": "optional space-delimited scopes"
}
```

**NEW: you can paste a config instead of filling in fields.**

Some MCP clients (Claude Desktop, Cursor, VS Code) save server settings as one JSON block. The block looks like `{"mcpServers": {...}}`. You can paste that block into the `config` field:

```
// request
{
  "config": "{\"mcpServers\": {\"airtable\": {\"url\": \"https://mcp.airtable.com/mcp\", \"headers\": {\"Authorization\": \"Bearer secret\"}}}}"
}
```

The backend reads `name`, `endpoint`, and `token` from this block. It reads `token` from a `headers.Authorization: Bearer ...` entry, if one exists.

Four rules apply to `config`:

1. The block must list exactly one server. A block with more than one server gets a `422` error. The error says "paste one server's config at a time".
2. The server must be a remote server. A remote server has a `url` field. A local server has `command`/`args` fields instead. The backend cannot run a local server. A local server entry gets a `422` error.
3. Explicit fields win over `config`. If you send `name` and `config` together, the backend uses your `name`. It only uses `config` to fill in fields you left out.
4. You must supply `name` and `endpoint`, one way or another. Send them as fields, or send a valid `config`. If you send neither, you get a `422` error.

A successful create returns a `201` status and the full `McpServerModel` (see the shape below).

Tool discovery (`tools/list`) runs during creation, not after. The response already lists the server's tools. If discovery failed, the response has `last_discovery_error` set instead.

Endpoint rules: the endpoint must use `https`. The endpoint must not point to `localhost` or a private IP address.

---

### `GET /mcp_servers` — list servers

This returns every server that belongs to the caller, as `McpServerModel[]`.

---

### `GET /mcp_servers/{id}` — get one server

This returns one server, by id.

---

### `PATCH /mcp_servers/{id}` — update a server

This request uses the same fields as create. All fields are optional. This request also accepts `config`.

Add an `etag` field to guard against overwriting someone else's change:

```json
{ "name": "...", "endpoint": "...", "token": "...", "oauth_client_id": "...", "oauth_client_secret": "...", "oauth_scope": "...", "config": "...", "etag": "the etag you last read" }
```

---

### `PATCH /mcp_servers/{id}/active` — turn a server on or off

```json
{ "active": false, "etag": "optional-etag" }
```

This does not delete the server's credential. The credential stays in storage. Only the server's `active` flag changes.

---

### `POST /mcp_servers/{id}/resync` — re-run tool discovery

Send this request with no body.

This re-runs `tools/list` against the server's endpoint. It returns the updated `McpServerModel`.

Call this after a successful OAuth sign-in. The backend does not re-run discovery on its own after sign-in.

---

### `DELETE /mcp_servers/{id}` — delete a server

A successful delete returns `204`, with no body.

This also deletes the server's Key Vault secrets. If the Key Vault delete fails, the whole request fails with a `502` error. In that case, the server record is **not** deleted. This rule exists to stop an orphaned secret from being left behind.

---

### `POST /mcp_servers/{id}/oauth/start` — start OAuth sign-in

Send this request with no body. The response looks like this:

```json
{ "authorization_url": "https://provider.example.com/authorize?...", "redirect_uri": "https://.../backend/webhook/mcp_servers/oauth/callback" }
```

Follow these steps to complete sign-in:

1. Open `authorization_url` in a popup window.
2. The user signs in with the provider, inside the popup.
3. The provider sends the popup to the backend's callback route.
4. The backend exchanges the code for a token and stores it.
5. The backend sends the popup to `MCP_OAUTH_FRONTEND_CALLBACK_URL`, with `?status=success` or `?status=error&reason=<slug>` on the URL.
6. Your callback page reads `status` and `reason` from its own URL.
7. Your callback page sends a message to the window that opened the popup. The popup cannot return a normal API response, so this message is the only way to report success or failure.
8. On success, call `/resync` yourself. The backend does not call it for you.

Possible values for `reason`: `provider_denied`, `state_mismatch`, `exchange_failed`, `internal_error`.

If a stored token stops working later, the server record gets a `credential_error` value (see the shape below). Check this field. If it is set, prompt the user to reconnect.

---

### `McpServerModel` shape

```
{
  "id": "MCP-<uuid>",
  "name": "string",
  "endpoint": "https://...",
  "has_credential": false,
  "oauth_connected": false,
  "oauth_client_id": null,
  "oauth_client_auth_method": null,
  "has_oauth_client_secret": false,
  "has_oauth_refresh_token": false,
  "oauth_token_endpoint": null,
  "oauth_resource": null,
  "oauth_scope": null,
  "token_expires_at": null,     // unix seconds
  "active": true,
  "tools": [
    { "name": "search", "title": "Search", "description": "...", "input_schema": { /* JSON schema */ } }
  ],
  "last_discovery_timestamp": 1234567890,
  "last_discovery_error": null,  // string reason if the last tools/list call failed
  "credential_error": null,      // string reason if a stored credential was refused; prompt reconnect
  "created_by": "user@nus.edu.sg",
  "updated_by": "user@nus.edu.sg",
  "creation_timestamp": 1234567890,
  "updated_timestamp": 1234567890,
  "etag": "\"abc123\""
}
```

Two fields hold secrets: `token` and `oauth_client_secret`. The backend never returns these values. It only returns booleans: `has_credential`, `has_oauth_client_secret`, `has_oauth_refresh_token`. Use these booleans to show connection status.

---

## 2. Per-conversation tool settings — `/conversation/{convo_id}/mcp/*`

This section is unchanged.

A server can have tools. A conversation must turn each tool on before the model can use it. Every new conversation starts with every tool turned on.

---

### `GET /conversation/{convo_id}/mcp/tools` — get the tool picker list

```
// response
{
  "servers": [
    {
      "server_id": "MCP-...",
      "name": "My Tool Server",
      "tools": [
        { "name": "search", "title": "Search", "description": "...", "switched_on": false, "allowed": false }
      ]
    }
  ]
}
```

This list only shows the caller's active servers.

`switched_on` means the model can call this tool this turn.

`allowed` means the tool runs without an approval card. A tool with `allowed: true` also has `switched_on: true`. The backend never sends the opposite combination. Do not assume the frontend enforces this rule too — check both fields yourself.

---

### `PATCH /conversation/{convo_id}/mcp/servers/{server_id}` — switch a whole server on or off

```json
{ "switched_on": true }
```

This turns every tool on that server on or off, in one request. A server has no separate on/off flag of its own — this action only changes its tools' flags.

The response lists the server's full state after the change:

```json
{ "switched_on": ["tool_a", "tool_b"], "allowed": ["tool_a"] }
```

---

### `PATCH /conversation/{convo_id}/mcp/servers/{server_id}/tools/{tool_name}` — switch one tool on or off

```json
{ "switched_on": true }
```

Turning a tool off also removes any "always allow" grant on it.

The response uses the same shape as the server-level switch above (`switched_on: string[]`, `allowed: string[]`).

---

### `PATCH /conversation/{convo_id}/mcp/servers/{server_id}/tools/{tool_name}/grant` — let a tool run without asking

```
{ "allowed": true }
```

This makes the same change "Always allow" makes from an approval card. The grant only applies to this one conversation. No grant applies across every conversation or every server.

---

## 3. Chat and the approval loop

---

### `POST /conversation/chat` — send a message

This endpoint streams its response over SSE, when the request sets `"stream": true`.

Request body:

```
{
  "approach": "llm",
  "convo_id": "...",
  "email": "user@nus.edu.sg",       // backend overwrites this from the auth header anyway
  "msg_id": "MSG-...",              // see id scheme below
  "llm_msg_id": "LLM-...",
  "stream": true,
  "regen": false,
  "history": [ { "user": "the message text" } ],
  "overrides": { "approach_settings": { "model_choice": "claude-..." } }
}
```

**NEW: the backend now locks the whole turn, not only the approval step.**

The backend locks the conversation as soon as it accepts a chat request. It holds the lock until the turn finishes, or until the turn pauses on approval cards. If the turn pauses, the paused message takes over the lock. From the frontend's point of view, treat this as one unbroken locked period.

A second request into a locked conversation gets rejected before the backend generates anything. The rejection uses one of three reasons:

```
// 409 body
{
  "reason": "turn_in_progress",
  "message": "A reply is still being generated in this conversation. Try again in a bit."
}
```

```
// 409 body — the conversation moved on since this tab last loaded it
{
  "reason": "stale_conversation",
  "message": "This conversation has changed since it was loaded. Refresh to continue."
}
```

```
// 422 body — msg_id/llm_msg_id don't fit the id-derivation scheme (a client bug, not a race)
{
  "reason": "invalid_message_ids",
  "message": "The message ids on this request are invalid."
}
```

Show different UI text for each reason:

- For `turn_in_progress`, tell the user to wait and try again. A refresh will not help — the other turn has not finished yet, so there is nothing new to load.
- For `stale_conversation`, tell the user to refresh. A refresh fixes the problem, because it forces the frontend to recompute `msg_id`/`llm_msg_id` from the real latest message.

The approval-pending `409` still exists, and its shape is unchanged. It now also carries a `reason` field:

```
// 409 body
{
  "reason": "approval_pending",     // or "approval_resolving"
  "message": "Answer the pending tool approvals before sending a new message.",
  "llm_msg_id": "LLM-...",
  "approval_state": "pending",      // or "resolving"
  "cards": [ /* ApprovalCard[] */ ]
}
```

`approval_resolving` is **NEW**. It means someone already submitted a decision, and the tool is running now. Do not show the composer in this state. Do not let the user submit decisions again — a second submit only returns `already_resolved`.

The response streams as SSE. Each frame has the shape `event: <name>\ndata: <json>\n\n`. These event names matter to the frontend:

| event | payload | meaning |
| --- | --- | --- |
| `llm_response` | string chunk | append to the answer, streamed token by token |
| `llm_mcp_tool_call_started` | `{ tool_use_id, tool, server, provider }` | a tool call began |
| `llm_mcp_tool_call_completed` | `{ tool_use_id, status: "success"\|"error"\|"declined" }` | a tool call finished |
| `llm_approval_required` | `{ cards: ApprovalCard[] }` | the turn paused; see below |
| `llm_error` | string or object | stream-level error |
| `token_usage` / `intent_token_usage` | usage object | for cost display |
| `keepalive` | `{}` | ignore; it only keeps the connection open |

---

### When a turn pauses: approval cards

The model can call a tool that needs approval. When this happens, the stream sends one `llm_approval_required` event, with one or more cards, and then ends.

The conversation is now locked. Any further `POST /conversation/chat` request gets a `409` error, until every card is answered. See the `approval_pending` / `approval_resolving` shapes above.

`ApprovalCard` shape:

```
{
  "type": "tool_approval",
  "tool_use_id": "...",
  "provider": "mcp",
  "tool_name": "search",
  "server_label": "My Tool Server",
  "description": "...",
  "input": { /* the literal tool call arguments the model produced, unmodified */ },
  "requires_approval": true,     // false = already allowed, shown for transparency but no control needed
  "grant_scope": "conversation", // always this value today, but treat it as an enum
  "status": "pending"            // NEW: "pending" | "resolving" | "resolved" | "interrupted"
  // "decision" is present once status is "resolved" or "interrupted": "always_allow" | "allow_once" | "deny"
}
```

**CHANGED: **`status`** now has four possible values, not two.**

- `"pending"` — the card waits for a decision.
- `"resolving"` — **new value.** Someone submitted a decision, and the tool is running now. Show this the same way you show a disabled or loading state. Do not show it as still waiting for input.
- `"resolved"` — the tool finished. The outcome is known.
- `"interrupted"` — **new value.** The outcome is not known. The process handling this card died, or its connection dropped, while the tool may have been running. In this case, the message text carries an extra note. One example note: *"This turn was interrupted after the tool approvals were answered. Approved tools may have run, so check their results before asking again."* Show this note to the user — do not hide it. An interrupted card still carries a `decision` value, but that value may not match what actually happened.

A card can have `requires_approval: false`. This card still ran, or will run, without asking. Show this card. Do not show approval controls for it.

---

### `GET /conversation/{convo_id}/approvals` — check the lock state

Call this on reload, on a second device, or after a dropped connection.

```
{
  "locked": true,
  "llm_msg_id": "LLM-...",
  "approval_state": "pending",   // NEW: "pending" | "resolving"
  "cards": [ /* ApprovalCard[] */ ],
  "turn_in_progress": false       // NEW: true while a turn is generating, before any cards exist
}
```

When `locked` is `false`, ignore `cards`, `llm_msg_id`, and `approval_state`. **Still check **`turn_in_progress`** in this case.** A turn can be generating with `locked: false`, before any card exists. Use `turn_in_progress` to show "a reply is being generated," instead of an open composer that would only get a `409` on submit.

---

### `POST /conversation/{convo_id}/approvals` — answer every card in one submit

```json
{ "decisions": [ { "tool_use_id": "...", "decision": "always_allow" } ] }
```

`decision` takes one of three values: `always_allow`, `allow_once`, `deny`.

One submit must answer every card that has `requires_approval: true`. A submit that misses one of these cards gets a `400` error. A card with `requires_approval: false` needs no entry — it runs on its own.

The response takes one of two shapes.

**Shape one: no continuation.** The response is plain JSON, an `ApprovalResolutionResponse`:

```
{ "status": "already_resolved" | "unlocked_without_pending_calls" | "resolved_without_model", "convo_id": "...", "llm_msg_id": "..." }
```

`already_resolved` now also covers one more case: a submit sent while `approval_state` is `resolving`, meaning someone else's decision is already running. Treat this the same as before — it is not an error. Do nothing further.

**Shape two: a continuation.** The response streams as SSE, in the same `event:`/`data:` format as `/conversation/chat`. It continues the same message (`llm_msg_id` stays the same). Append new text to the existing message. Do not start a new message.

A `decision` of `always_allow` also writes a grant, the same way `PATCH .../tools/{tool}/grant` does. After this, the tool will not ask again in this conversation.

---

### `GET /conversation/{convo_id}/stream-records` — recover the step feed

This section is unchanged.

Use this endpoint to render the steps that led to a paused card, after a reload. The original SSE stream is gone by then, so this endpoint replaces it.

```
GET /conversation/{convo_id}/stream-records?scope=last
GET /conversation/{convo_id}/stream-records?scope=all&limit=50&offset=0
```

`scope=last` returns the events for the newest assistant message:

```json
{ "msg_id": "LLM-...", "records": [ { "seq": 0, "event": "llm_response", "timestamp": "...", "data": "..." } ] }
```

`scope=all` returns events across the whole conversation, in pages:

```
{ "messages": { "<llm_msg_id>": [ /* records */ ] }, "limit": 50, "offset": 0, "has_more": false }
```

---

### `GET /conversation/load?convo_id=...&email=...&id_only=false` — load full history

This section is unchanged, and is not specific to MCP. It appears here because a resumed conversation needs it to redraw the transcript.

This includes resolved approval cards. Each one appears as a `part` on its assistant message, with `type: "tool_approval"`. Some of these cards may now carry `status: "interrupted"` — see the approval card section above.

---

## Summary of what's new for the frontend

- `POST /mcp_servers` accepts a `config` field. Use it as an alternative to individual fields.
- `POST /conversation/chat` can now return a `409` or `422` error for reasons that have nothing to do with approvals: `turn_in_progress`, `stale_conversation`, `invalid_message_ids`. Check the `reason` field. Show different text for each. Only `stale_conversation` gets fixed by a refresh.
- Approval cards have two new `status` values: `resolving` and `interrupted`. Handle both. Do not treat an unrecognized status as `pending`.
- `GET /approvals` has two new fields: `approval_state` and `turn_in_progress`. Check `turn_in_progress` even when `locked` is `false`.
- The approval-pending `409` now carries a `reason` field, either `approval_pending` or `approval_resolving`. Do not let the user resubmit decisions while the reason is `approval_`
