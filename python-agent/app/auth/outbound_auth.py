import base64
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_auth_mode, require_env
from app.errors import AgentError


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _encode_auth_envelope(payload: dict[str, str]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _build_canonical_string(
    method: str,
    path: str,
    timestamp_ms: str,
    body: str,
    target_agent_did: str | None = None,
) -> str:
    """Canonical format used by platform advanced signature verifier."""
    return "\n".join(
        [
            method.upper(),
            path,
            timestamp_ms,
            target_agent_did or "",
            f"sha256:{_sha256_hex(body)}",
        ]
    )


def _build_envelope(
    method: str,
    path: str,
    body: str,
    target_agent_did: str | None = None,
    session_fields: dict[str, str] | None = None,
) -> dict[str, str]:
    """
    Core envelope builder shared by both outbound and MCP session auth.

    Simple mode produces: { auth_mode, agent_did, agent_secret }
    Advanced mode produces: { auth_mode, agent_did, timestamp, signature, algorithm, **session_fields }

    MCP session auth passes session_fields to bind the credential to the specific
    request that established the session (session_method, session_path, etc.).
    Regular outbound auth omits session_fields.
    """
    mode = get_auth_mode()
    agent_did = require_env("AGENT_DID", "AGENT_DID is required")

    if mode == "simple":
        api_key = os.getenv("AGENT_SECRET") or os.getenv("AGENT_API_KEY")
        if not api_key:
            raise AgentError(
                "CONFIG_INVALID",
                "AGENT_SECRET or AGENT_API_KEY is required for simple auth mode",
                False,
                500,
            )
        return {
            "Authorization": "Bearer "
            + _encode_auth_envelope(
                {
                    "auth_mode": "simple",
                    "agent_did": agent_did,
                    "agent_secret": api_key,
                }
            ),
        }

    alg = os.getenv("AGENT_SIGNATURE_ALGORITHM", "RS256")
    private_key = require_env(
        "AGENT_PRIVATE_KEY_PEM",
        "AGENT_PRIVATE_KEY_PEM is required for advanced auth mode",
    )
    timestamp_ms = str(int(datetime.now(timezone.utc).timestamp() * 1000))
    canonical = _build_canonical_string(
        method=method,
        path=path,
        timestamp_ms=timestamp_ms,
        body=body,
        target_agent_did=target_agent_did,
    )
    token = jwt.encode(
        payload={
            "data": canonical,
            "canonical": canonical,
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(seconds=60),
        },
        key=private_key,
        algorithm=alg,
        headers=({"kid": os.getenv("AGENT_KEY_ID")} if os.getenv("AGENT_KEY_ID") else None),
    )
    envelope: dict[str, str] = {
        "auth_mode": "advanced",
        "agent_did": agent_did,
        "timestamp": timestamp_ms,
        "signature": token,
        "algorithm": alg,
    }
    if session_fields:
        envelope.update(session_fields)

    return {"Authorization": "Bearer " + _encode_auth_envelope(envelope)}


def build_outbound_auth_headers(
    method: str,
    path: str,
    body: str,
    target_agent_did: str | None = None,
) -> dict[str, str]:
    """
    Outbound auth headers for platform API calls (`/api/v1/a2a/send`).
    Also used for direct MCP tool auth injection.
    """
    return _build_envelope(method, path, body, target_agent_did)


def build_mcp_session_auth_headers(
    method: str,
    path: str,
    body: str,
    target_agent_did: str | None = None,
) -> dict[str, str]:
    """
    MCP session auth headers.
    Same as outbound auth but the advanced envelope includes session_* fields
    that bind the credential to the request that established the MCP session.
    The platform stores this session server-side; the agent refreshes it every
    MCP_SESSION_TTL_MS and retries once on 401.
    """
    return _build_envelope(
        method,
        path,
        body,
        target_agent_did,
        session_fields={
            "session_method": method.upper(),
            "session_path": path,
            "session_body_hash": _sha256_hex(body),
            "session_target_agent_did": target_agent_did or "",
        },
    )
