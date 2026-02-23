# Python Agent - Blueprint 03

This folder contains Agent 03: **Compliance Risk Auditor**.

Intent implemented:
- `ops.audit`

Behavior:
- Verifies inbound platform auth (`simple` HMAC or `advanced` JWT/JWKS).
- Validates strict `a2a_forward` envelope and `ops.audit` input schema.
- Uses OpenAI to produce audit findings/recommendations.
- Validates strict `ops.audit` output schema before returning.
- Acts as terminal chain specialist (no delegation by default).

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

Simple mode:
- `AGENT_SECRET`

Advanced mode:
- `PLATFORM_JWKS_URL`
- optional `PLATFORM_JWT_ISSUER`

## Render deploy

- Root directory: `python-agent`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health path: `/health`
