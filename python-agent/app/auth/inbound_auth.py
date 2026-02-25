import hashlib
import os

import jwt
from jwt import PyJWKClient

from app.config import require_env
from app.errors import AgentError

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = require_env(
            "PLATFORM_JWKS_URL",
            "PLATFORM_JWKS_URL is required for inbound platform JWT verification",
        )
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


def verify_inbound_auth(
    headers: dict, raw_body: bytes, task_id: str, correlation_id: str
) -> None:
    auth = headers.get("authorization")
    if not isinstance(auth, str) or not auth.startswith("Bearer "):
        raise AgentError("AUTH_INVALID", "Missing platform bearer token", False, 401)

    token = auth.replace("Bearer ", "", 1).strip()
    audience = require_env(
        "AGENT_DID", "AGENT_DID is required for inbound platform auth verification"
    )
    jwk_client = _get_jwks_client()
    issuer = os.getenv("PLATFORM_JWT_ISSUER", "federated-agent-platform")
    body_hash = hashlib.sha256(raw_body).hexdigest()

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
    if isinstance(payload.get("body_hash"), str) and payload["body_hash"] not in {
        body_hash,
        f"sha256:{body_hash}",
    }:
        raise AgentError("AUTH_INVALID", "JWT body_hash mismatch", False, 401)

    source_agent_claim = payload.get("source_agent")
    source_agent_header = headers.get("x-source-agent-id")
    if (
        isinstance(source_agent_claim, str)
        and isinstance(source_agent_header, str)
        and source_agent_claim != source_agent_header
    ):
        raise AgentError("AUTH_INVALID", "JWT source_agent mismatch", False, 401)
