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
- `MCP_HTTP_URL`

Simple mode:
- `AGENT_SECRET`
- `AGENT_API_KEY`

Advanced mode:
- `PLATFORM_JWKS_URL`
- `AGENT_PRIVATE_KEY_PEM`
- optional `PLATFORM_JWT_ISSUER`, `AGENT_SIGNATURE_ALGORITHM`, `AGENT_KEY_ID`

## Render deploy

- Root directory: `python-agent`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health path: `/health`
