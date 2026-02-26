# Python Agent - Blueprint 03

This folder contains Agent 03: **Compliance Risk Auditor**.

Intent implemented:
- `ops.audit`

Behavior:
- Verifies inbound platform JWT auth via JWKS.
- Validates strict `a2a_forward` envelope and `ops.audit` input schema.
- Uses OpenAI Python SDK tool-calling loop (`responses.create`) for runtime decisions.
- Uses MCP tools for context/route discovery:
  - `get_task_context`
  - `list_reachable_routes`
  - `get_route_details`
  - `delegate_task` (only when LLM decides and lineage depth allows)
- Validates strict `ops.audit` output schema before returning.
- Acts as terminal specialist by default, with optional LLM-driven delegation.

## High-Level flow

This agent uses the same production-style lifecycle expected from external integrations:

1. Platform forwards task to `POST /a2a` as `a2a_forward`.
2. Agent validates envelope schema (`app/validation.py`).
3. Agent verifies inbound platform JWT (`app/auth/inbound_auth.py`):
   - JWKS signature check
   - `aud`/`iss`/`task_id` checks
   - optional parity checks (`method`, `path`, `body_hash`, `source_agent`)
4. Intent router (`app/agent_runner.py`) dispatches to `ops.audit`.
5. Intent handler (`app/agents/ops_audit.py`) performs:
   - payload validation
   - OpenAI Responses tool-calling loop
   - MCP route discovery/context lookup and optional delegation
6. MCP wrapper (`app/mcp_client.py`) injects outbound auth headers for tool calls.
7. Agent returns normalized `a2a_response` success/failure envelope.

This keeps strict I/O contracts for platform testing while still allowing LLM-driven decisions.

## Local setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Run:

```bash
python -m app.main
```

Default port: `3300`.

## Required env vars

- `AGENT_DID`
- `AGENT_AUTH_MODE` (`simple` or `advanced`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS` (optional, default `1200`)
- `MCP_HTTP_URL` (Xano MCP stream endpoint, e.g. `.../mcp/stream`)

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

## Render deploy

- Root directory: `python-agent`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health path: `/health`
