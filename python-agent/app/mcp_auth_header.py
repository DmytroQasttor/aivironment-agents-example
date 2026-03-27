import os
import time
from typing import Any
from urllib.parse import urlparse

from jwcrypto import jwk, jwt
from jwcrypto.common import base64url_encode

from app.auth.outbound_auth import build_outbound_auth_headers
from app.errors import AgentError


def _get_auth_mode() -> str:
    mode = os.getenv("AGENT_AUTH_MODE", "simple").lower()
    if mode not in {"simple", "advanced"}:
        raise AgentError(
            "CONFIG_INVALID",
            "AGENT_AUTH_MODE must be either simple or advanced",
            False,
            500,
        )
    return mode


def _require_agent_did() -> str:
    agent_did = os.getenv("AGENT_DID")
    if not isinstance(agent_did, str) or not agent_did:
        raise AgentError("CONFIG_INVALID", "AGENT_DID is required", False, 500)
    return agent_did


def _require_agent_secret() -> str:
    agent_secret = os.getenv("AGENT_SECRET") or os.getenv("AGENT_API_KEY")
    if not isinstance(agent_secret, str) or not agent_secret:
        raise AgentError(
            "CONFIG_INVALID",
            "AGENT_SECRET or AGENT_API_KEY is required for simple MCP auth mode",
            False,
            500,
        )
    return agent_secret


def _require_jwe_key() -> jwk.JWK:
    raw_key = os.getenv("MCP_AGENT_AUTH_JWE_KEY")
    if not isinstance(raw_key, str) or not raw_key:
        raise AgentError(
            "CONFIG_INVALID",
            "MCP_AGENT_AUTH_JWE_KEY is required for MCP governance auth",
            False,
            500,
        )
    raw_bytes = raw_key.encode("utf-8")
    if len(raw_bytes) != 32:
        raise AgentError(
            "CONFIG_INVALID",
            "MCP_AGENT_AUTH_JWE_KEY must be exactly 32 UTF-8 bytes for A256KW",
            False,
            500,
        )
    return jwk.JWK(kty="oct", k=base64url_encode(raw_bytes))


def build_mcp_authorization_header(spec: dict[str, Any] | None = None) -> str:
    auth_mode = _get_auth_mode()
    spec = spec or {}
    mcp_url = os.getenv("MCP_HTTP_URL", "https://example.com/mcp/stream")
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "aiv-governance-mcp-auth",
        "aud": "agent-governance-mcp",
        "auth_type": auth_mode,
        "agent_did": _require_agent_did(),
        "iat": now,
        "exp": now + 300,
    }

    if auth_mode == "simple":
        claims["agent_secret"] = _require_agent_secret()
    else:
        auth_headers = build_outbound_auth_headers(
            method=spec.get("method", "POST"),
            path=spec.get("path") or urlparse(mcp_url).path,
            body=spec.get("body", ""),
            target_agent_did=spec.get("targetAgentDid") or spec.get("target_agent_did"),
        )
        claims["timestamp_header"] = auth_headers.get("X-Timestamp")
        claims["signature_header"] = auth_headers.get("X-Signature")
        claims["algorithm_header"] = auth_headers.get("X-Signature-Algorithm", "RS256")

    token = jwt.JWT(
        header={"alg": "A256KW", "enc": "A256GCM", "typ": "JWT"},
        claims=claims,
    )
    token.make_encrypted_token(_require_jwe_key())
    return f"Bearer {token.serialize()}"
