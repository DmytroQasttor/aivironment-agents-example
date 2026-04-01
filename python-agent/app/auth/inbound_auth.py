import hashlib
import json
import os

import jwt
from jwt import PyJWKClient

from app.config import require_env
from app.errors import AgentError
from app.utils.log import log_error, log_info

_jwks_client: PyJWKClient | None = None


def _inbound_debug_enabled() -> bool:
    value = os.getenv("INBOUND_AUTH_DEBUG", "")
    return value in ("1", "true", "TRUE", "True")


def _log_inbound_debug(message: str, **fields) -> None:
    if not _inbound_debug_enabled():
        return
    log_info(message, **fields)


def _get_jwks_client() -> PyJWKClient:
    """Lazily create JWKS client for platform JWT verification."""
    global _jwks_client
    if _jwks_client is None:
        jwks_url = require_env(
            "PLATFORM_JWKS_URL",
            "PLATFORM_JWKS_URL is required for inbound platform JWT verification",
        )
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


def _sort_keys_deep(value):
    """Recursively sort object keys while preserving list order."""
    if isinstance(value, list):
        return [_sort_keys_deep(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _sort_keys_deep(value[key]) for key in sorted(value.keys())}


def _body_hash_candidates(raw_body: bytes) -> set[str]:
    """Compute body hashes that match the platform's canonical JSON hashing."""
    candidates = {hashlib.sha256(raw_body).hexdigest()}
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
        canonical = json.dumps(
            _sort_keys_deep(parsed), separators=(",", ":"), ensure_ascii=False
        )
        candidates.add(hashlib.sha256(canonical.encode("utf-8")).hexdigest())
    except Exception:
        pass
    return candidates


def verify_inbound_auth(
    headers: dict, raw_body: bytes, task_id: str, correlation_id: str
) -> None:
    """Verify the platform JWT before any intent logic is allowed to run."""
    _log_inbound_debug(
        "Inbound auth request",
        task_id=task_id,
        correlation_id=correlation_id,
        header_keys=sorted(headers.keys()),
        headers=headers,
        raw_body_utf8=raw_body.decode("utf-8", errors="replace"),
    )

    auth = headers.get("authorization")
    if not isinstance(auth, str) or not auth.startswith("Bearer "):
        raise AgentError("AUTH_INVALID", "Missing platform bearer token", False, 401)

    token = auth.replace("Bearer ", "", 1).strip()
    audience = require_env(
        "AGENT_DID", "AGENT_DID is required for inbound platform auth verification"
    )
    jwk_client = _get_jwks_client()
    issuer = os.getenv("PLATFORM_JWT_ISSUER", "federated-agent-platform")
    body_hashes = _body_hash_candidates(raw_body)

    try:
        allowed_alg = os.getenv("PLATFORM_JWT_ALGORITHM", "RS256")
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=[allowed_alg],
            audience=audience,
            issuer=issuer,
            options={"verify_signature": True, "verify_aud": True},
        )
        _log_inbound_debug(
            "Inbound auth JWT decoded",
            task_id=task_id,
            correlation_id=correlation_id,
            jwt_payload=payload,
            body_hash_candidates=sorted(body_hashes),
        )
    except Exception:
        raise AgentError("AUTH_INVALID", "Invalid platform bearer token", False, 401)

    token_task_id = payload.get("task_id")
    if not isinstance(token_task_id, str) or not token_task_id:
        raise AgentError("AUTH_INVALID", "JWT task_id claim is required", False, 401)
    if token_task_id != task_id:
        raise AgentError("AUTH_INVALID", "JWT task binding mismatch", False, 401)
    if isinstance(payload.get("method"), str) and payload["method"].upper() != "POST":
        raise AgentError("AUTH_INVALID", "JWT method mismatch", False, 401)
    if isinstance(payload.get("path"), str) and payload["path"] != "/a2a":
        raise AgentError("AUTH_INVALID", "JWT path mismatch", False, 401)
    body_hash_claim = payload.get("body_hash")
    accepted_hashes = body_hashes | {f"sha256:{body_hash}" for body_hash in body_hashes}
    if isinstance(body_hash_claim, str) and body_hash_claim not in accepted_hashes:
        if _inbound_debug_enabled():
            log_error(
                "Inbound auth body hash mismatch",
                task_id=task_id,
                correlation_id=correlation_id,
                jwt_body_hash=body_hash_claim,
                accepted_hashes=sorted(accepted_hashes),
                raw_body_utf8=raw_body.decode("utf-8", errors="replace"),
            )
        raise AgentError("AUTH_INVALID", "JWT body_hash mismatch", False, 401)

    source_agent_claim = payload.get("source_agent")
    source_agent_header = headers.get("x-source-agent-id")
    if (
        isinstance(source_agent_claim, str)
        and isinstance(source_agent_header, str)
        and source_agent_claim != source_agent_header
    ):
        raise AgentError("AUTH_INVALID", "JWT source_agent mismatch", False, 401)
