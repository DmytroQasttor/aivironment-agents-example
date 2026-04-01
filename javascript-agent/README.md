# JavaScript Agent - Blueprint 02

This folder contains Agent 02: **Execution Task Coordinator**.

Intent implemented:
- `ops.orchestrate`

Behavior:
- Validates inbound `a2a_forward` request and platform JWT auth.
- Uses OpenAI Agents SDK native remote MCP support for agent decisions.
- Model decides whether to complete locally or delegate through the Xano governance MCP.
- Returns strict `a2a_response` result format.

## High-Level flow

This agent follows the same production-style lifecycle expected from external integrations:

1. Platform forwards task to `POST /a2a` with `a2a_forward`.
2. Agent validates envelope schema (`src/validation/schemas.js`).
3. Agent verifies inbound platform JWT (`src/auth/inboundAuth.js`):
   - JWKS signature check
   - `aud`/`iss`/`task_id` checks
   - optional claim parity checks (`method`, `path`, `body_hash`, `source_agent`)
4. Intent router (`src/agentRunner.js`) dispatches to `ops.orchestrate`.
5. Intent handler (`src/agents/opsCoordinate.js`) performs:
   - payload validation
   - OpenAI Agents SDK run with native remote MCP access
   - MCP route discovery and optional delegation through the server-provided tool catalog
6. `src/openai/mcpServer.js` creates `MCPServerStreamableHttp` with a custom `fetch`.
7. The transport auth helpers establish one MCP session bearer envelope, let the platform create a stored MCP session, and reuse it for later MCP requests in that session.
8. Handler returns normalized `a2a_response` success/failure envelope.

This gives deterministic platform contracts while preserving LLM-driven runtime decisions.

## Integration-kit (for FE/Docs instructions)

If you only need endpoint + MCP connection guidance (without business validation), use:

- `src/integration-kit/types.js` - base `a2a_forward` shape check helper
- `src/integration-kit/connectionEndpoint.js` - minimal `/a2a` endpoint factory
- `src/integration-kit/healthEndpoint.js` - minimal `/health` payload builder
- `src/integration-kit/index.js` - barrel exports

## Run

```bash
npm install
npm run dev
```

Default port: `3200`.

## Required env

- `AGENT_DID`
- `AGENT_AUTH_MODE`
- `MCP_HTTP_URL` (Xano MCP stream endpoint, e.g. `.../mcp/stream`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS` (optional, default `1200`)

Simple mode:
- `AGENT_SECRET`
- optional `AGENT_API_KEY` legacy alias, but prefer `AGENT_SECRET` for all new deploys

Advanced mode:
- `PLATFORM_JWKS_URL`
- `AGENT_PRIVATE_KEY_PEM`
- optional `PLATFORM_JWT_ISSUER`, `AGENT_SIGNATURE_ALGORITHM`, `AGENT_KEY_ID`

## Authorization summary

Platform -> Agent (`/a2a`):
- `Authorization: Bearer <platform_jwt>`
- verified against `PLATFORM_JWKS_URL`

Agent -> Platform direct APIs:
- simple mode: `Authorization: Bearer <base64url-json-envelope>`
- advanced mode: `Authorization: Bearer <base64url-json-envelope>`
- advanced envelopes carry `timestamp`, `signature`, and `algorithm`

Agent -> MCP:
- simple mode: one `Authorization: Bearer <base64url-json-envelope>` for the MCP session
- advanced mode: one `Authorization: Bearer <base64url-json-envelope>` for the MCP session, signed from the session-establishing MCP request
- The native MCP transport owns session establishment, reuse, refresh, and one retry on unauthorized.

Direct API advanced signatures use canonical format:

```text
{METHOD}
{PATH}
{TIMESTAMP_MS}
{TARGET_AGENT_DID_OR_EMPTY}
sha256:{BODY_HASH_HEX}
```

For MCP, the same canonical format is used only to establish the session bearer envelope. For body hash parity this example canonicalizes JSON by recursively sorting object keys.
