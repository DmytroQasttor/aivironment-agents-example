# JavaScript Agent - Blueprint 02

This folder contains Agent 02: **Execution Task Coordinator**.

Intent implemented:
- `ops.orchestrate`

Behavior:
- Validates inbound `a2a_forward` request and platform JWT auth.
- Uses OpenAI Node SDK tool-calling loop (`responses.create`) for agent decisions.
- Model decides whether to complete locally or delegate, and chooses target intent/payload via MCP tools.
- Calls MCP tools when needed:
  - `get_task_context`
  - `list_reachable_routes`
  - `get_route_details`
  - `delegate_task`
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
   - LLM tool-calling loop with OpenAI Responses API
   - MCP route discovery and optional delegation
6. MCP wrapper (`src/mcp/mcpClientHttp.js`) injects outbound auth for each tool call.
7. Handler returns normalized `a2a_response` success/failure envelope.

This gives deterministic platform contracts while preserving LLM-driven runtime decisions.

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
- `AGENT_API_KEY`

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

Advanced signatures use canonical format:

```text
{METHOD}
{PATH}
{TIMESTAMP_MS}
{TARGET_AGENT_DID_OR_EMPTY}
sha256:{BODY_HASH_HEX}
```

For body hash parity this example canonicalizes JSON by recursively sorting object keys.
