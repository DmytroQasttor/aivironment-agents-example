import os
import jwt
from jwt import PyJWKClient

from app.config import get_auth_mode, require_env
from app.errors import AgentError
from app.utils.signature import verify_signature

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = require_env(
            "PLATFORM_JWKS_URL",
            "PLATFORM_JWKS_URL is required for advanced auth mode",
        )
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


def _verify_simple(headers: dict, raw_body: bytes) -> None:
    secret = require_env("AGENT_SECRET", "AGENT_SECRET is required for simple auth mode")
    signature = headers.get("x-platform-signature")
    timestamp = headers.get("x-platform-timestamp")
    if not isinstance(signature, str) or not isinstance(timestamp, str):
        raise AgentError("AUTH_INVALID", "Missing simple auth headers", False, 401)

    if not verify_signature(raw_body, signature, timestamp, secret):
        raise AgentError("AUTH_INVALID", "Invalid platform signature", False, 401)


def _verify_advanced(headers: dict, task_id: str, correlation_id: str) -> None:
    auth = headers.get("authorization")
    if not isinstance(auth, str) or not auth.startswith("Bearer "):
        raise AgentError("AUTH_INVALID", "Missing bearer token", False, 401)

    token = auth.replace("Bearer ", "", 1).strip()
    audience = require_env("AGENT_DID", "AGENT_DID is required for advanced auth mode")
    jwk_client = _get_jwks_client()

    issuer = os.getenv("PLATFORM_JWT_ISSUER")

    try:
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256", "HS256"],
            audience=audience,
            **({"issuer": issuer} if issuer else {}),
            options={"verify_signature": True, "verify_aud": True},
        )
    except Exception:
        raise AgentError("AUTH_INVALID", "Invalid platform bearer token", False, 401)

    if isinstance(payload.get("task_id"), str) and payload["task_id"] != task_id:
        raise AgentError("AUTH_INVALID", "JWT task binding mismatch", False, 401)
    if (
        isinstance(payload.get("correlation_id"), str)
        and payload["correlation_id"] != correlation_id
    ):
        raise AgentError("AUTH_INVALID", "JWT correlation binding mismatch", False, 401)


def verify_inbound_auth(
    headers: dict, raw_body: bytes, task_id: str, correlation_id: str
) -> None:
    # A single entrypoint keeps the auth contract clear and easy to document.
    mode = get_auth_mode()
    if mode == "simple":
        _verify_simple(headers, raw_body)
        return
    _verify_advanced(headers, task_id, correlation_id)
