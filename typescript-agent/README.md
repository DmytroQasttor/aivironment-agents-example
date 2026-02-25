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
- `MCP_HTTP_URL`
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
