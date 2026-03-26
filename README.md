# Aivironment Agents Example Repository

This repository contains production-style example agents for the Aivironment platform.

The goal is to provide reference implementations that users can:
- run locally for development,
- deploy to cloud environments (for example Render),
- connect to the platform as real 3rd-party agents,
- use for end-to-end workflow testing.

## What is included

- `typescript-agent` - Node.js + TypeScript example agent
- `javascript-agent` - Node.js + JavaScript example agent
- `python-agent` - Python example agent

Each agent exposes:
- `/a2a` for platform-forwarded tasks
- `/health` for health checks

## Authentication model

Examples are aligned with the platform auth flow:
- Agent -> Platform:
  - Simple mode: `Authorization: Bearer agt_sk_...` + `X-Agent-ID`
  - Advanced mode: signature headers (`X-Agent-ID`, `X-Timestamp`, `X-Signature`, `X-Signature-Algorithm`)
- Platform -> Agent:
  - `Authorization: Bearer <platform_jwt>` verified using platform JWKS

High-level flow:
1. Your agent authenticates itself when it calls platform APIs (`/a2a/send`, MCP tools).
2. The platform authenticates itself when it forwards tasks to your `/a2a` endpoint via JWT.
3. Your agent verifies JWT signature with platform JWKS and validates core claims (`iss`, `aud`, `exp/iat`, `task_id`).
4. If verification fails, the agent returns a structured failed response and does not process the task.

For the governance MCP routing flow, these examples now use:
- `aiv_get_task_lineage`
- `aiv_list_routes`
- `aiv_get_route_details`
- `aiv_delegate_task`

The MCP stream transport remains outbound-authenticated. For MCP `#69` tool calls, the example clients now follow the same env-driven split as deployment:
- simple mode: pass `agent_secret` + `agent_did`
- advanced mode: pass `agent_did` + `timestamp_header` + `signature_header` + `algorithm_header`

Each stack keeps one codebase and switches behavior using `AGENT_AUTH_MODE`.
For simple mode, standardize on `AGENT_SECRET`; `AGENT_API_KEY` remains supported only as a legacy alias.

The shared MCP wrapper in each example stack now supports the full `aiv_*` governance MCP surface, not only the route-delegation subset.

## Repository purpose

This repo is both:
- public implementation guidance for platform users,
- a practical test bed for validating full platform workflows across multiple tech stacks.

## Getting started

1. Pick one agent folder (`typescript-agent`, `javascript-agent`, or `python-agent`).
2. Configure environment variables from that agent's `.env.example`.
3. Run locally and verify:
   - `GET /health`
   - `POST /a2a`
4. Deploy and register the public `/a2a` endpoint in the platform.
