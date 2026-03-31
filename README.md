# Aivironment Agents Example Repository

This repository contains production-style example agents for the Aivironment platform.

The goal is to provide reference implementations that developers can:
- run locally for development and testing,
- deploy to cloud environments (e.g. Render),
- connect to the platform as real third-party agents,
- use as a starting point when building their own agents.

---

## What is included

| Agent | Stack | Intent | Role in chain |
|-------|-------|--------|---------------|
| `typescript-agent` | Node.js + TypeScript | `ops.coordinate` | Agent 01 — Planning Coordinator (chain entry point) |
| `javascript-agent` | Node.js + JavaScript | `ops.orchestrate` | Agent 02 — Execution Coordinator (delegates downstream) |
| `python-agent` | Python + FastAPI | `ops.audit` | Agent 03 — Compliance Auditor (chain terminal) |

Each agent exposes two HTTP endpoints:
- `POST /a2a` — receives forwarded tasks from the platform
- `GET /health` — health check used by the platform and deployment targets

---

## How the agents connect

The three agents form a delegation chain that demonstrates multi-hop A2A task routing, depth tracking, and lineage continuity:

```
Platform
   │
   ▼
[Agent 01] typescript-agent   ops.coordinate  (plans the work)
   │  delegates via MCP aiv_delegate_task
   ▼
[Agent 02] javascript-agent   ops.orchestrate  (coordinates execution)
   │  delegates compliance work via MCP aiv_delegate_task
   ▼
[Agent 03] python-agent       ops.audit  (compliance risk review, terminal node)
```

Each hop preserves `task_id`, `correlation_id`, `parent_task_id`, and `depth` so the platform can track the full task lineage and enforce delegation depth limits (`max_depth`).

This chain is the main scenario used to validate:
- multi-agent delegation with approval gates
- schema compliance end-to-end
- MCP route discovery and intent matching
- lineage context propagation

---

## Authentication model

### Platform → Agent (inbound)

The platform forwards tasks to your `/a2a` endpoint as `POST` requests with:
- `Authorization: Bearer <platform_jwt>`

Your agent verifies this JWT against the platform JWKS URL. Validated claims:
- `iss` — platform issuer
- `aud` — your `AGENT_DID`
- `exp` / `iat` — expiry and issued-at window
- `task_id` — must match the task in the request body
- Optional parity claims: `method`, `path`, `body_hash`, `source_agent`

### Agent → Platform (outbound)

Used when calling `/api/v1/a2a/send` or MCP governance tools.

**Simple mode** (recommended for getting started):
- `Authorization: Bearer <base64url-json-envelope>`
- Envelope contains: `{ auth_mode: "simple", agent_did, agent_secret }`

**Advanced mode** (signature-based):
- `Authorization: Bearer <base64url-json-envelope>`
- Envelope contains: `{ auth_mode: "advanced", agent_did, timestamp, signature, algorithm }`
- Signature is an RS256 (or configured algorithm) JWS over a canonical string:
  ```
  METHOD
  PATH
  TIMESTAMP_MS
  TARGET_AGENT_DID_OR_EMPTY
  sha256:BODY_HASH_HEX
  ```

Switch between modes using the `AGENT_AUTH_MODE` environment variable (`simple` or `advanced`).

### Agent → MCP (session-based)

MCP uses session-level auth rather than per-request auth:
- One `Authorization: Bearer <base64url-json-envelope>` is sent when the MCP session is established.
- The platform stores the session server-side with an inactivity timeout.
- Agents proactively refresh the session every 8 minutes and retry once on `401`.
- For simple mode, the envelope is the same as outbound auth above.
- For advanced mode, the envelope includes additional `session_*` fields that bind the session to the original request parameters.

---

## Getting started

### 1. Pick a stack

Choose the agent folder that matches your stack:
- `typescript-agent` — Node.js 18+, TypeScript, Express
- `javascript-agent` — Node.js 18+, ES modules, Express
- `python-agent` — Python 3.9+, FastAPI, Uvicorn

### 2. Register your agent in the platform

Before you can run an agent, you need:
- An **Agent DID** — created when you register an agent in the platform UI.
- An **Agent Secret** (simple mode) or **RSA private key** (advanced mode) — generated in the platform agent settings.
- The platform **JWKS URL** and **JWT issuer** — available in the platform developer settings.
- The **MCP HTTP URL** — the platform's governance MCP stream endpoint.

Start with simple mode. Advanced mode is only needed when you require signature-based non-repudiation.

### 3. Configure environment variables

Copy the `.env.example` in your chosen agent folder and fill in your values:

```bash
cd typescript-agent        # or javascript-agent or python-agent
cp .env.example .env
# Edit .env with your platform credentials
```

Required variables for simple mode:
```
AGENT_DID=did:agent:your-agent-id
AGENT_AUTH_MODE=simple
AGENT_SECRET=agt_sk_...
MCP_HTTP_URL=https://your-platform/mcp/stream
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
PLATFORM_JWKS_URL=https://your-platform/.well-known/jwks.json
PLATFORM_JWT_ISSUER=federated-agent-platform
```

### 4. Install and run locally

**TypeScript:**
```bash
cd typescript-agent
npm install
npm run build
node dist/server.js
```

**JavaScript:**
```bash
cd javascript-agent
npm install
node src/server.js
```

**Python:**
```bash
cd python-agent
pip install -r requirements.txt
uvicorn app.main:app --port 3300
```

### 5. Test the health endpoint

```bash
curl http://localhost:3000/health     # typescript-agent
curl http://localhost:3200/health     # javascript-agent
curl http://localhost:3300/health     # python-agent
```

### 6. Test the A2A endpoint locally

The platform will send a request like this to your `/a2a` endpoint. You can simulate it:

```bash
curl -X POST http://localhost:3000/a2a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <platform_jwt>" \
  -d '{
    "type": "a2a_forward",
    "task_id": "test-task-001",
    "timestamp": "2026-03-31T12:00:00Z",
    "source": {
      "agent_id": "did:agent:platform",
      "agent_name": "Platform",
      "workspace_id": "ws-1"
    },
    "intent": "ops.coordinate",
    "payload": {
      "objective": "Plan a Q2 product launch",
      "priority": "high",
      "constraints": ["budget_cap_50k", "3_month_timeline"],
      "metadata": {
        "owner": "product-team",
        "region": "EU",
        "risk_score": 0.4
      }
    },
    "context": {
      "correlation_id": "corr-001",
      "parent_task_id": null,
      "depth": 0,
      "max_depth": 3
    }
  }'
```

> **Note:** During local testing, inbound JWT verification may fail unless you provide a valid platform JWT. You can temporarily disable `verifyInboundAuth` for local smoke tests, but always re-enable it before deployment.

### 7. Deploy and register the public endpoint

Deploy to any host that exposes a public HTTPS URL (Render, Railway, Fly.io, etc.).

Render example settings:
- **TypeScript:** Root dir `typescript-agent`, start command `npm run build && node dist/server.js`
- **JavaScript:** Root dir `javascript-agent`, start command `node src/server.js`
- **Python:** Root dir `python-agent`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Once deployed, register your public `/a2a` URL in the platform agent settings as the agent's endpoint.

---

## Building your own agent

To build a new agent from these templates:

1. **Copy the stack folder** that matches your language.
2. **Define your intent and schemas** — update `validation/schemas.ts` (or equivalent) with your intent's input and output JSON schemas.
3. **Update the agent logic file** — replace the agent name, instructions, and output type in the `agents/` file.
4. **Update the intent router** — add your new intent to `agentRunner.ts` (or equivalent).
5. **Update `.env.example`** with any new required variables.
6. **Register the new intent** in the platform agent capabilities settings.

See [`docs/third-party-agents-general-guide.md`](docs/third-party-agents-general-guide.md) for the full development checklist.

---

## Repository structure

```
aivironment-agents-example/
├── README.md
├── docs/                             # Developer guides and blueprints
│   ├── agent-auth-complete-guide.md  # Full auth reference (simple + advanced)
│   ├── mcp-session-auth.md           # MCP session auth details
│   ├── fe-connection-health-endpoint-guide.md
│   ├── third-party-agent-blueprint-01.md   # Blueprint for ops.coordinate agent
│   ├── third-party-agent-blueprint-02.md   # Blueprint for ops.orchestrate agent
│   ├── third-party-agent-blueprint-03.md   # Blueprint for ops.audit agent
│   ├── third-party-agents-general-guide.md # General implementation checklist
│   └── improvement-report.md         # Known improvements and recommendations
├── typescript-agent/                 # Agent 01: Delivery Planning Coordinator
│   ├── src/
│   │   ├── server.ts                 # Express app + route registration
│   │   ├── agentRunner.ts            # Intent routing switch
│   │   ├── handlers/a2aHandler.ts    # Main request handler (parse → auth → run → respond)
│   │   ├── agents/opsCoordinate.ts   # ops.coordinate business logic + LLM run
│   │   ├── auth/inboundAuth.ts       # Platform JWT verification
│   │   ├── auth/outboundAuth.ts      # Outbound auth header builders
│   │   ├── mcp/mcpTransportAuth.ts   # Custom fetch wrapper with session auth
│   │   ├── openai/mcpServer.ts       # MCP server factory
│   │   ├── openai/openaiClient.ts    # OpenAI config helpers
│   │   ├── validation/schemas.ts     # AJV validators for envelope + intents
│   │   ├── utils/                    # agentError, log, signature helpers
│   │   ├── integration-kit/          # Minimal stubs for health + connection endpoints
│   │   └── types/                    # TypeScript types for A2A contracts
│   └── .env.example
├── javascript-agent/                 # Agent 02: Execution Task Coordinator
│   └── src/                          # Same structure as typescript-agent, no type annotations
├── python-agent/                     # Agent 03: Compliance Risk Auditor
│   └── app/
│       ├── main.py                   # FastAPI app setup
│       ├── handlers.py               # /a2a and /health endpoint handlers
│       ├── agent_runner.py           # Intent routing
│       ├── agents/ops_audit.py       # ops.audit business logic + LLM run
│       ├── auth/                     # Inbound JWT + outbound auth headers
│       ├── openai_mcp.py             # MCP server factory with session auth
│       ├── validation.py             # jsonschema validators
│       ├── config.py                 # Environment config helpers
│       ├── errors.py                 # AgentError class
│       ├── responses.py              # Response envelope builders
│       ├── utils/                    # log, signature helpers
│       └── integration_kit/          # Minimal stubs for health + connection endpoints
```

---

## Key concepts

### `a2a_forward` envelope

Every request the platform sends to your `/a2a` endpoint follows this shape:

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
  "payload": { "...intent-specific fields..." },
  "context": {
    "correlation_id": "string",
    "parent_task_id": "string | null",
    "depth": 0,
    "max_depth": 3
  }
}
```

### `a2a_response` envelope

Your agent must always return this shape — success or failure:

```json
{
  "type": "a2a_response",
  "task_id": "same-as-input-task_id",
  "status": "completed",
  "result": { "...intent-specific result..." }
}
```

On failure:
```json
{
  "type": "a2a_response",
  "task_id": "same-as-input-task_id",
  "status": "failed",
  "error": {
    "code": "EXECUTION_FAILED",
    "message": "human readable description",
    "retryable": true
  }
}
```

### Integration kit

Each agent includes a minimal `integration-kit/` module. These are thin stubs that demonstrate the minimum required endpoint shapes without any business logic. Use them as a starting skeleton when implementing the `/health` and `/a2a` endpoints in a new agent.

### Error codes

All agents use a consistent set of error codes:

| Code | Meaning | Retryable |
|------|---------|-----------|
| `CONFIG_INVALID` | Missing or invalid environment variable | No |
| `AUTH_INVALID` | Platform JWT verification failed | No |
| `PAYLOAD_INVALID` | Request body or intent schema validation failed | No |
| `INTENT_UNSUPPORTED` | Agent does not handle the requested intent | No |
| `OUTPUT_INVALID` | Agent produced a result that failed output schema validation | No |
| `EXECUTION_FAILED` | Unexpected runtime error | Yes |

---

## Further reading

- [`docs/agent-auth-complete-guide.md`](docs/agent-auth-complete-guide.md) — complete auth reference for simple and advanced modes
- [`docs/mcp-session-auth.md`](docs/mcp-session-auth.md) — how MCP session auth works
- [`docs/third-party-agents-general-guide.md`](docs/third-party-agents-general-guide.md) — general implementation checklist
- [`docs/third-party-agent-blueprint-01.md`](docs/third-party-agent-blueprint-01.md) — blueprint for the planning coordinator
- [`docs/third-party-agent-blueprint-02.md`](docs/third-party-agent-blueprint-02.md) — blueprint for the execution coordinator
- [`docs/third-party-agent-blueprint-03.md`](docs/third-party-agent-blueprint-03.md) — blueprint for the compliance auditor
