# JavaScript Agent - Blueprint 02

This folder contains Agent 02: **Execution Task Coordinator**.

Intent implemented:
- `ops.orchestrate`

Behavior:
- Validates inbound `a2a_forward` request and auth (simple/advanced).
- Uses OpenAI Node SDK tool-calling loop (`responses.create`) for agent decisions.
- Model decides whether to complete locally or delegate, and chooses target intent/payload via MCP tools.
- Calls MCP tools when needed:
  - `get_task_context`
  - `list_reachable_routes`
  - `get_route_details`
  - `delegate_task`
- Returns strict `a2a_response` result format.

## Run

```bash
npm install
npm run dev
```

Default port: `3200`.

## Required env

- `AGENT_DID`
- `AGENT_AUTH_MODE`
- `MCP_HTTP_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Simple mode:
- `AGENT_SECRET`
- `AGENT_API_KEY`

Advanced mode:
- `PLATFORM_JWKS_URL`
- `AGENT_PRIVATE_KEY_PEM`
- optional `PLATFORM_JWT_ISSUER`, `AGENT_SIGNATURE_ALGORITHM`, `AGENT_KEY_ID`
