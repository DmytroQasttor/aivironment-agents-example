# TypeScript Agent - Blueprint 01

This is a production-like external agent example for the Aivironment platform.

Implemented profile:
- Name: `Delivery Planning Coordinator`
- Intent: `ops.coordinate`
- Purpose: turn a business objective into an execution-ready plan and optionally delegate through MCP routes.

Use this agent to manually validate full platform workflow in UI:
- inbound auth,
- intent routing,
- strict schema validation,
- MCP route discovery,
- delegation + lineage behavior,
- normalized `a2a_response` output.

## High-Level flow

This agent implements the same runtime pattern expected from real 3rd-party integrations:

1. Platform forwards a task to `POST /a2a` as `a2a_forward`.
2. Agent validates the raw JSON envelope structure with AJV (`src/validation/schemas.ts`).
3. Agent verifies platform JWT auth (`src/auth/inboundAuth.ts`):
   - signature against `PLATFORM_JWKS_URL`
   - required claims (`aud`, `iss`, `task_id`)
   - optional parity claims when present (`method`, `path`, `body_hash`, `source_agent`)
4. Agent routes by `intent` in `src/agentRunner.ts`.
5. For `ops.coordinate`, the handler (`src/agents/opsCoordinate.ts`) does:
   - payload schema validation
   - OpenAI Agents SDK run with native remote MCP access
   - direct use of the Xano-provided governance MCP tool catalog
6. For MCP access, `src/openai/mcpServer.ts` creates `MCPServerStreamableHttp` with a custom `fetch`.
7. The transport auth helpers establish one MCP session bearer envelope and reuse it for later MCP requests:
   - simple mode: bearer envelope with `auth_mode`, `agent_did`, `agent_secret`
   - advanced mode: bearer envelope with signed session-establishing MCP request fields
8. Handler returns normalized `a2a_response`:
   - `status: completed` + JSON object `result`
   - or `status: failed` + structured `error`

This keeps behavior deterministic for platform E2E tests while still allowing LLM-driven decisions at runtime.

## Features

- `POST /a2a` endpoint with strict `a2a_forward` envelope validation
- Intent routing map (`ops.coordinate` implemented)
- Inbound platform auth:
  - `Authorization: Bearer <platform_jwt>` verified via JWKS (for all agents)
- Outbound auth for MCP calls (same auth family as platform)
- OpenAI Agents SDK native remote MCP integration for runtime decisions
- Xano governance MCP exposed to model natively from the server itself
- Model decides local completion vs delegation at runtime
- Structured failure envelope with error code/message/retryable

## Project structure

- `src/server.ts` - Express app and routes
- `src/handlers/a2aHandler.ts` - envelope validation, auth verification, response normalization
- `src/agentRunner.ts` - intent router
- `src/agents/opsCoordinate.ts` - Blueprint 01 intent logic + native MCP-backed OpenAI loop
- `src/validation/schemas.ts` - strict input/output schema validation
- `src/auth/inboundAuth.ts` - simple/advanced inbound auth checks
- `src/auth/outboundAuth.ts` - simple/advanced outbound headers/signing
- `src/openai/mcpServer.ts` - native remote MCP server bootstrap for the Xano governance MCP
- `src/mcp/mcpTransportAuth.ts` - per-request MCP transport header generation for simple/advanced modes
- `src/utils/signature.ts` - timing-safe HMAC verification

### Integration-kit (for FE/Docs instructions)

If you need only platform connection endpoint + health endpoint + MCP tool connection logic, use:

- `src/integration-kit/types.ts` - minimal `a2a_forward` and `a2a_response` types
- `src/integration-kit/connectionEndpoint.ts` - minimal `/a2a` endpoint factory (no business schema validation)
- `src/integration-kit/healthEndpoint.ts` - minimal `/health` payload builder
- `src/integration-kit/index.ts` - barrel exports

This module is intentionally narrow and can be used as the base code in frontend instruction pages.

## Prerequisites

- Node.js 18+
- npm
- platform credentials
- MCP endpoint

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env
```

3. Configure required values:

- `AGENT_DID`
- `AGENT_AUTH_MODE` (`simple` or `advanced`)
- `MCP_HTTP_URL` (Xano MCP stream endpoint, e.g. `.../mcp/stream`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS` (optional, default `1200`)

For `simple` mode:
- `AGENT_SECRET`
- optional `AGENT_API_KEY` legacy alias, but prefer `AGENT_SECRET` for all new deploys

For `advanced` mode:
- `PLATFORM_JWKS_URL`
- `PLATFORM_JWT_ISSUER` (optional but recommended)
- `AGENT_PRIVATE_KEY_PEM`
- `AGENT_SIGNATURE_ALGORITHM` (default `RS256`)
- `AGENT_KEY_ID` (optional)


4. Run agent:

```bash
npm run dev
```

Default port: `3000`.

## Build / run

```bash
npm run build
npm start
```

## Request contract (inbound)

`POST /a2a` expects a platform-forwarded payload with:
- `type: "a2a_forward"`
- `task_id`
- `intent`
- `payload`
- `context` (`correlation_id`, `depth`, `max_depth`, `parent_task_id`, ...)

Supported intent:
- `ops.coordinate`

## Authorization model

Platform -> Agent (`/a2a`):
- `Authorization: Bearer <platform_jwt>`
- Agent validates JWT via JWKS and optional claim parity checks.

Agent -> Platform direct APIs:
- `AGENT_AUTH_MODE=simple`
  - `Authorization: Bearer <agent_secret_or_key>`
  - `X-Agent-ID: <agent_did>`
- `AGENT_AUTH_MODE=advanced`
  - `X-Agent-ID`
  - `X-Timestamp` (epoch ms)
  - `X-Signature-Algorithm` (default `RS256`)
  - `X-Signature` (JWS over canonical string)

Agent -> MCP:
- `AGENT_AUTH_MODE=simple`
  - `Authorization: Bearer <base64url-json-envelope>`
  - envelope contains `auth_mode`, `agent_did`, `agent_secret`
- `AGENT_AUTH_MODE=advanced`
  - `Authorization: Bearer <base64url-json-envelope>`
  - envelope contains `auth_mode`, `agent_did`, `timestamp`, `signature`, `algorithm`, `session_method`, `session_path`, `session_body_hash`, `session_target_agent_did`
- The custom MCP transport builds this bearer envelope once per MCP session, the platform stores a server-side MCP session, and the client refreshes proactively with one retry on unauthorized.

Advanced direct API canonical format:

```text
{METHOD}
{PATH}
{TIMESTAMP_MS}
{TARGET_AGENT_DID_OR_EMPTY}
sha256:{BODY_HASH_HEX}
```

For MCP, the same canonical format is used only to establish the MCP session bearer envelope. For body hash parity, this example canonicalizes JSON by recursively sorting object keys before hashing.

## Response contract (outbound)

Success:

```json
{
  "type": "a2a_response",
  "task_id": "same-task-id",
  "status": "completed",
  "result": {
    "plan": "...",
    "actions": [],
    "score": 0.85
  }
}
```

Failure:

```json
{
  "type": "a2a_response",
  "task_id": "same-task-id",
  "status": "failed",
  "error": {
    "code": "PAYLOAD_INVALID",
    "message": "...",
    "retryable": false
  }
}
```

## Local check

```bash
curl http://localhost:3000/health
```

Notes:
- Direct API advanced auth keeps the short request-bound validation window.
- MCP advanced auth is session-based and should refresh before the inactivity timeout expires.
