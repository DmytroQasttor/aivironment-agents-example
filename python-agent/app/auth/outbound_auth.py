import hashlib
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_auth_mode, require_env


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


def build_outbound_auth_headers(
    method: str,
    path: str,
    body: str,
    target_agent_did: str | None = None,
) -> dict[str, str]:
    # Shared auth model used by all agents when calling platform MCP tools.
    mode = get_auth_mode()
    agent_did = require_env("AGENT_DID", "AGENT_DID is required")

    if mode == "simple":
        api_key = require_env(
            "AGENT_API_KEY", "AGENT_API_KEY is required for simple auth mode"
        )
        return {
            "Authorization": f"Bearer {api_key}",
            "X-Agent-ID": agent_did,
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

    payload = {
        "data": canonical,
        "canonical": canonical,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=60),
    }
    token = jwt.encode(
        payload=payload,
        key=private_key,
        algorithm=alg,
        headers=({"kid": os.getenv("AGENT_KEY_ID")} if os.getenv("AGENT_KEY_ID") else None),
    )

    return {
        "X-Agent-ID": agent_did,
        "X-Timestamp": timestamp_ms,
        "X-Signature": token,
        "X-Signature-Algorithm": alg,
    }
