# Aivironment Agents Example Repository

This repository contains three production-style example agents for the Aivironment platform. Each one is a runnable integration example, not just a code sketch.

The examples are meant to show:

- what the platform sends to an external agent
- how an agent verifies inbound platform auth
- how an agent calls platform APIs directly
- how an agent connects to the governance MCP
- how delegation and lineage behave across multiple agents

## Included agents

| Agent              | Stack                | Intent            | Role in chain         |
| ------------------ | -------------------- | ----------------- | --------------------- |
| `typescript-agent` | Node.js + TypeScript | `ops.coordinate`  | Planning coordinator  |
| `javascript-agent` | Node.js + JavaScript | `ops.orchestrate` | Execution coordinator |
| `python-agent`     | Python + FastAPI     | `ops.audit`       | Compliance auditor    |

Each agent exposes:

- `POST /a2a` for platform-forwarded tasks
- `GET /health` for liveness checks

## Delegation chain

These examples form a simple multi-hop chain:

```text
Platform
  |
  v
typescript-agent   ops.coordinate
  |
  v
javascript-agent   ops.orchestrate
  |
  v
python-agent       ops.audit
```

Each hop preserves:

- `task_id`
- `correlation_id`
- `parent_task_id`
- `depth`

That lets the platform keep lineage and enforce delegation rules.

## Authentication model

### Platform -> Agent

The platform forwards work to `/a2a` with:

- `Authorization: Bearer <platform_jwt>`

Each example verifies that JWT against platform JWKS and checks the task/body claims needed to trust the request.

### Agent -> Platform direct APIs

When an agent calls direct platform endpoints such as `/api/v1/a2a/send`, it sends a bearer auth envelope in `Authorization`.

Simple mode envelope:

- `auth_mode`
- `agent_did`
- `agent_secret`

Advanced mode envelope:

- `auth_mode`
- `agent_did`
- `timestamp`
- `signature`
- `algorithm`

Advanced signatures are built over the canonical request string:

```text
METHOD
PATH
TIMESTAMP_MS
TARGET_AGENT_DID_OR_EMPTY
sha256:BODY_HASH_HEX
```

### Agent -> MCP

MCP auth is session-based.

- The transport sends one bearer envelope in `Authorization`.
- The platform creates a stored MCP session from that envelope.
- Later MCP calls reuse that server-side session.
- The transport refreshes the session before inactivity expiry and retries once on unauthorized.

For advanced MCP auth, the bearer envelope includes the extra `session_*` fields needed to prove the session-establishing MCP request.

## Getting started

### 1. Pick a stack

Choose the folder that matches your stack:

- `typescript-agent`
- `javascript-agent`
- `python-agent`

### 2. Register the agent in the platform

You will need:

- an `AGENT_DID`
- either an `AGENT_SECRET` for simple mode or a private key for advanced mode
- `PLATFORM_JWKS_URL`
- platform issuer if you enforce it
- `MCP_HTTP_URL`

### 3. Configure environment variables

Copy the local example file and fill in your platform values:

```bash
cd typescript-agent
cp .env.example .env
```

Required variables depend on the selected auth mode, but every example expects at least:

- `AGENT_DID`
- `AGENT_AUTH_MODE`
- `MCP_HTTP_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

### 4. Run locally

TypeScript:

```bash
cd typescript-agent
npm install
npm run build
node dist/server.js
```

JavaScript:

```bash
cd javascript-agent
npm install
node src/server.js
```

Python:

```bash
cd python-agent
pip install -r requirements.txt
uvicorn app.main:app --port 3300
```

### 5. Check health

```bash
curl http://localhost:3000/health
curl http://localhost:3200/health
curl http://localhost:3300/health
```

### 6. Deploy

Deploy to any host that exposes a public HTTPS URL, then register the public `/a2a` URL in the platform agent settings.

## Build your own agent from these examples

1. Copy the stack folder closest to your runtime.
2. Replace the intent schemas with your own input/output contracts.
3. Replace the intent handler logic in the `agents/` module.
4. Update the intent router.
5. Update `.env.example` with any new required variables.
6. Register the new intent/capabilities in the platform.

## Repository structure

```text
aivironment-agents-example/
├── README.md
├── typescript-agent/
│   ├── src/handlers/a2aHandler.ts
│   ├── src/auth/inboundAuth.ts
│   ├── src/auth/outboundAuth.ts
│   ├── src/mcp/mcpTransportAuth.ts
│   └── src/agents/opsCoordinate.ts
├── javascript-agent/
│   ├── src/handlers/a2aHandler.js
│   ├── src/auth/inboundAuth.js
│   ├── src/auth/outboundAuth.js
│   ├── src/mcp/mcpTransportAuth.js
│   └── src/agents/opsCoordinate.js
└── python-agent/
    ├── app/handlers.py
    ├── app/auth/inbound_auth.py
    ├── app/auth/outbound_auth.py
    ├── app/openai_mcp.py
    └── app/agents/ops_audit.py
```

## Key concepts

### `a2a_forward`

The platform sends work in this envelope:

```json
{
  "type": "a2a_forward",
  "task_id": "uuid",
  "timestamp": "ISO 8601",
  "source": {
    "agent_id": "did:agent:...",
    "agent_name": "string",
    "workspace_id": "string"
  },
  "intent": "ops.coordinate",
  "payload": {},
  "context": {
    "correlation_id": "string",
    "parent_task_id": null,
    "depth": 0,
    "max_depth": 3
  }
}
```

### `a2a_response`

Every agent returns this envelope on both success and failure:

```json
{
  "type": "a2a_response",
  "task_id": "same-as-input",
  "status": "completed",
  "result": {}
}
```

Failure shape:

```json
{
  "type": "a2a_response",
  "task_id": "same-as-input",
  "status": "failed",
  "error": {
    "code": "EXECUTION_FAILED",
    "message": "human readable description",
    "retryable": true
  }
}
```

### Integration kit

Each stack includes a minimal integration-kit module with stripped-down endpoint helpers. Use that when you want only the platform boundary code without the example business logic.

## Read next

- Start with the stack-specific README in `typescript-agent`, `javascript-agent`, or `python-agent`.
- The most important platform-boundary files in each example are:
  - inbound `/a2a` handler
  - inbound auth verifier
  - outbound auth builder
  - MCP transport wrapper
