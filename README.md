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

