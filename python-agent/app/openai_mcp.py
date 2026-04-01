import json
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from agents.mcp import MCPServerStreamableHttp

from app.auth.outbound_auth import build_mcp_session_auth_headers
from app.errors import AgentError
from app.utils.log import log_mcp_debug

# MCP session TTL must be shorter than the platform's server-side inactivity timeout (10 min).
MCP_SESSION_TTL_MS = 8 * 60 * 1000


def _summarize_auth_headers(auth_headers: dict[str, str]) -> dict[str, str | None]:
    return {
        key: (value[:32] if isinstance(value, str) else None)
        for key, value in auth_headers.items()
    }


def _resolve_request_auth_spec(request: httpx.Request) -> dict[str, Any]:
    body = request.content.decode("utf-8") if request.content else ""

    try:
        parsed = json.loads(body)
    except Exception:
        parsed = None

    return {
        "method": request.method.upper(),
        "path": request.url.path or "/",
        "body": body,
    }


class GovernanceMcpAuth(httpx.Auth):
    def __init__(self) -> None:
        self._session_auth_headers: dict[str, str] | None = None
        self._session_started_ms = 0

    def _get_session_headers(
        self,
        auth_spec: dict[str, Any],
        force_refresh: bool = False,
    ) -> tuple[dict[str, str], bool]:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        should_create_session = (
            force_refresh
            or self._session_auth_headers is None
            or (now_ms - self._session_started_ms) >= MCP_SESSION_TTL_MS
        )
        if should_create_session:
            # The first request after connect or refresh establishes the MCP session.
            self._session_auth_headers = build_mcp_session_auth_headers(
                method=str(auth_spec.get("method", "POST")),
                path=str(auth_spec.get("path", "/")),
                body=str(auth_spec.get("body", "")),
                target_agent_did=auth_spec.get("target_agent_did"),
            )
            self._session_started_ms = now_ms
            log_mcp_debug(
                "mcp auth session established",
                {
                    "method": auth_spec.get("method"),
                    "path": auth_spec.get("path"),
                    "session_ttl_ms": MCP_SESSION_TTL_MS,
                    "forced_refresh": force_refresh,
                },
            )

        return self._session_auth_headers or {}, (not should_create_session)

    def auth_flow(self, request: httpx.Request):
        auth_spec = _resolve_request_auth_spec(request)
        log_mcp_debug(
            "sending request",
            {
                "method": auth_spec.get("method"),
                "path": auth_spec.get("path"),
                "target_agent_did": auth_spec.get("target_agent_did"),
            },
        )
        auth_headers, reused = self._get_session_headers(auth_spec, False)
        for key, value in auth_headers.items():
            request.headers[key] = value
        log_mcp_debug(
            "auth header attached",
            {
                "mcp_session_reused": reused,
                "auth_header_present": isinstance(auth_headers.get("Authorization"), str),
                "auth_header_prefix": (
                    auth_headers.get("Authorization", "")[:16]
                    if isinstance(auth_headers.get("Authorization"), str)
                    else None
                ),
                "auth_envelope_mode": "authorization-bearer",
                "auth_header_names": list(auth_headers.keys()),
                "auth_header_values": _summarize_auth_headers(auth_headers),
            },
        )
        response = yield request
        if response.status_code == 401:
            log_mcp_debug(
                "mcp session unauthorized, refreshing",
                {
                    "method": auth_spec.get("method"),
                    "path": auth_spec.get("path"),
                },
            )
            retry_headers, _ = self._get_session_headers(auth_spec, True)
            retry_request = httpx.Request(
                method=request.method,
                url=request.url,
                headers=request.headers,
                content=request.content,
            )
            for key, value in retry_headers.items():
                retry_request.headers[key] = value
            yield retry_request


def create_governance_mcp_server() -> MCPServerStreamableHttp:
    server_url = os.getenv("MCP_HTTP_URL")
    if not isinstance(server_url, str) or not server_url:
        raise AgentError(
            "CONFIG_INVALID",
            "MCP_HTTP_URL is required for native MCP access",
            False,
            500,
        )

    return MCPServerStreamableHttp(
        name=os.getenv("MCP_SERVER_LABEL", "aiv_governance_mcp"),
        params={
            "url": server_url,
            "auth": GovernanceMcpAuth(),
        },
        cache_tools_list=True,
    )
