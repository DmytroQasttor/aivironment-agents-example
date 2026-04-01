# Python Agent - Blueprint 03

This folder contains Agent 03: **Compliance Risk Auditor**.

Intent implemented:
- `ops.audit`

Behavior:
- Verifies inbound platform JWT auth via JWKS.
- Validates strict `a2a_forward` envelope and `ops.audit` input schema.
- Uses the OpenAI Agents SDK with native remote MCP for runtime decisions.
- Establishes one MCP session bearer envelope through the transport auth layer and reuses it for later MCP requests.
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
   - OpenAI Agents SDK run with native remote MCP access
   - direct use of the Xano-provided governance MCP tool catalog
6. `app/openai_mcp.py` creates `MCPServerStreamableHttp` with custom `httpx.Auth`.
7. The transport auth helpers establish one MCP session bearer envelope, let the platform create a stored MCP session, and reuse it for later MCP requests in that session.
8. Agent returns normalized `a2a_response` success/failure envelope.

This keeps strict I/O contracts for platform testing while still allowing LLM-driven decisions.

## Integration-kit (for FE/Docs instructions)

If you only need endpoint + MCP connection guidance (without business validation), use:

- `app/integration_kit/types.py` - base `a2a_forward` shape check helper
- `app/integration_kit/connection_endpoint.py` - minimal `/a2a` endpoint factory
- `app/integration_kit/health_endpoint.py` - minimal `/health` payload builder
- `app/integration_kit/__init__.py` - package exports

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

## Dependency note

This native MCP version depends on the Python Agents SDK stack and therefore uses:
- `fastapi==0.135.1`
- `openai-agents==0.13.2`

Those versions were chosen to keep the FastAPI app compatible with the SDK's current Starlette dependency chain.

## Render deploy

- Root directory: `python-agent`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health path: `/health`
