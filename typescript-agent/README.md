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
   - OpenAI Responses API tool-calling loop
   - MCP tool invocation via stream transport (`src/mcp/mcpClientHttp.ts`)
6. During MCP tool calls, outbound auth is injected (`src/auth/outboundAuth.ts`):
   - simple mode: bearer API key + agent DID
   - advanced mode: canonical request string signed as JWS (RS256 by default)
7. Handler returns normalized `a2a_response`:
   - `status: completed` + JSON object `result`
   - or `status: failed` + structured `error`

This keeps behavior deterministic for platform E2E tests while still allowing LLM-driven decisions at runtime.

## Features

- `POST /a2a` endpoint with strict `a2a_forward` envelope validation
- Intent routing map (`ops.coordinate` implemented)
- Inbound platform auth:
  - `Authorization: Bearer <platform_jwt>` verified via JWKS (for all agents)
- Outbound auth for MCP calls (same auth family as platform)
- OpenAI Node SDK tool-calling loop (`responses.create`) for runtime decisions
- MCP tools exposed to model:
  - `get_task_context`
  - `list_reachable_routes`
  - `get_route_details`
  - `delegate_task`
- Model decides local completion vs delegation at runtime
- Structured failure envelope with error code/message/retryable

## Project structure

- `src/server.ts` - Express app and routes
- `src/handlers/a2aHandler.ts` - envelope validation, auth verification, response normalization
- `src/agentRunner.ts` - intent router
- `src/agents/opsCoordinate.ts` - Blueprint 01 intent logic + SDK tool-calling agent loop
- `src/validation/schemas.ts` - strict input/output schema validation
- `src/auth/inboundAuth.ts` - simple/advanced inbound auth checks
- `src/auth/outboundAuth.ts` - simple/advanced outbound headers/signing
- `src/mcp/mcpClientHttp.ts` - MCP JSON-RPC transport + tool wrappers
- `src/utils/signature.ts` - timing-safe HMAC verification

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
- `AGENT_API_KEY`

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

Agent -> Platform and MCP tools:
- `AGENT_AUTH_MODE=simple`
  - `Authorization: Bearer <agent_secret_or_key>`
  - `X-Agent-ID: <agent_did>`
- `AGENT_AUTH_MODE=advanced`
  - `X-Agent-ID`
  - `X-Timestamp` (epoch ms)
  - `X-Signature-Algorithm` (default `RS256`)
  - `X-Signature` (JWS over canonical string)

Advanced canonical format:

```text
{METHOD}
{PATH}
{TIMESTAMP_MS}
{TARGET_AGENT_DID_OR_EMPTY}
sha256:{BODY_HASH_HEX}
```

For body hash parity, this example canonicalizes JSON by recursively sorting object keys before hashing.

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
- Use the exact raw JSON body when generating simple-mode HMAC signatures.
- Keep timestamp fresh (5-minute validation window).
