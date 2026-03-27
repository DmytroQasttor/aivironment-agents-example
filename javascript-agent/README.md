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
7. The transport auth helpers rebuild one opaque JWE `Authorization` header for each outgoing MCP request.
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
- `MCP_AGENT_AUTH_JWE_KEY` (32 UTF-8 bytes, shared with Xano for MCP auth envelope)
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

Agent -> Platform/MCP:
- simple mode: `Authorization` + `X-Agent-ID`
- advanced mode: `X-Agent-ID` + `X-Timestamp` + `X-Signature-Algorithm` + `X-Signature`

Agent -> MCP transport:
- `Authorization: Bearer <opaque_jwe_token>`
- JWE payload includes:
  - simple mode: `auth_type`, `agent_did`, `agent_secret`
  - advanced mode: `auth_type`, `agent_did`, `timestamp_header`, `signature_header`, optional `algorithm_header`
- The native MCP transport builds this automatically for each request and the model sees MCP tools directly from the Xano server.

Advanced signatures use canonical format:

```text
{METHOD}
{PATH}
{TIMESTAMP_MS}
{TARGET_AGENT_DID_OR_EMPTY}
sha256:{BODY_HASH_HEX}
```

For body hash parity this example canonicalizes JSON by recursively sorting object keys.
