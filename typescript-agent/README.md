# TypeScript Agent Example

This folder contains a **Node.js + TypeScript** example agent for the Aivironment Agents Platform.

Use this project as a starting point if you want to:
- receive signed tasks from the platform,
- run an LLM-based agent loop,
- optionally call MCP tools,
- return a normalized `a2a_response` payload.

## What this example includes

- `POST /a2a` endpoint for platform task delivery
- HMAC signature verification (`x-platform-signature`, `x-platform-timestamp`)
- OpenAI Responses API integration
- MCP JSON-RPC client helpers (`tools/list`, `tools/call`)
- `GET /health` endpoint for health checks

## Project structure

- `src/server.ts`: Express app and route wiring
- `src/handlers/a2aHandler.ts`: signed request handling + response mapping
- `src/agentRunner.ts`: iterative agent execution loop
- `src/agents/taskAgent.ts`: base prompt strategy
- `src/mcp/mcpClientHttp.ts`: MCP HTTP JSON-RPC client
- `src/utils/signature.ts`: HMAC verification helper

## Prerequisites

- Node.js 18+
- npm
- OpenAI API key
- (Optional) MCP server endpoint

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

Required values:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (example: `gpt-5.2-mini`)
- `AGENT_SECRET` (must match your platform agent secret)

Runtime URLs used by this code:
- `MCP_HTTP_URL` (for MCP HTTP JSON-RPC)
- `MCP_SSE_URL` (only needed if you use the SSE helper)

3. Start in development mode:

```bash
npm run dev
```

Default port is `3000` (configurable with `PORT`).

## Production build

```bash
npm run build
npm start
```

## Platform request contract

The `POST /a2a` handler expects:
- raw JSON body,
- `x-platform-timestamp` header,
- `x-platform-signature` header in format `sha256=<hex>`.

Signature input:
- `"<timestamp>.<rawBody>"` hashed with HMAC-SHA256 using `AGENT_SECRET`.

If valid, the handler runs the agent and returns:

```json
{
  "type": "a2a_response",
  "task_id": "...",
  "status": "completed",
  "result": {}
}
```

On failure, it returns:

```json
{
  "type": "a2a_response",
  "task_id": "...",
  "status": "failed",
  "error": {
    "code": "PROCESSING_FAILED",
    "message": "..."
  }
}
```

## Local test tips

- Health check:

```bash
curl http://localhost:3000/health
```

- For `/a2a`, send exact raw JSON used for signature generation.
- Keep timestamp fresh (the verifier accepts a 5-minute window).

## Notes for users

This is an intentionally minimal example meant for integration clarity, not production hardening. Before production use, add:
- structured logging,
- retries/timeouts/circuit breaking,
- stricter input schema validation,
- observability and tracing,
- robust error taxonomy.
