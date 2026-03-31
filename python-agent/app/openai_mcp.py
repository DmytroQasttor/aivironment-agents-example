import json
import os
from typing import Any

import httpx
from agents.mcp import MCPServerStreamableHttp

from app.auth.outbound_auth import build_mcp_session_auth_headers
from app.errors import AgentError

MCP_SESSION_TTL_MS = 15 * 60 * 1000


def _mcp_debug_enabled() -> bool:
    value = os.getenv("MCP_DEBUG", "")
    return value in ("1", "true", "TRUE", "True")


def _log_mcp_debug(message: str, data: dict[str, Any] | None = None) -> None:
    if not _mcp_debug_enabled():
        return
    if data is None:
        print("[mcp-debug]", message)
        return
    print("[mcp-debug]", message, json.dumps(data, ensure_ascii=False))


def _summarize_auth_headers(auth_headers: dict[str, str]) -> dict[str, str | None]:
    return {
        key: (value[:32] if isinstance(value, str) else None)
        for key, value in auth_headers.items()
    }


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _sort_json_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _sort_json_value(value[key]) for key in sorted(value.keys())}
    return value


def _stable_json(value: Any) -> str:
    return json.dumps(_sort_json_value(value), separators=(",", ":"), ensure_ascii=False)


def _resolve_tool_auth_spec(params: dict[str, Any]) -> dict[str, Any] | None:
    name = params.get("name")
    tool_args = params.get("arguments")
    if not isinstance(name, str) or not isinstance(tool_args, dict):
        return None

    if name == "aiv_list_routes":
        return {"method": "GET", "path": "/api/v1/runtime/routes", "body": ""}
    if name == "aiv_get_route_details":
        slug = tool_args.get("slug")
        if not isinstance(slug, str) or not slug:
            return None
        return {
            "method": "GET",
            "path": f"/api/v1/runtime/routes/{slug}",
            "body": "",
        }
    if name == "aiv_get_task_lineage":
        task_id = tool_args.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            return None
        return {
            "method": "GET",
            "path": f"/api/v1/runtime/task-context/{task_id}",
            "body": "",
        }
    if name == "aiv_delegate_task":
        target_agent = tool_args.get("target_agent")
        if not isinstance(target_agent, str) or not target_agent:
            return None
        canonical_body: dict[str, Any] = {
            "target_agent": target_agent,
            "intent": tool_args.get("intent"),
            "payload": tool_args.get("payload"),
            "connection": tool_args.get("connection"),
        }
        if isinstance(tool_args.get("context"), dict):
            canonical_body["context"] = tool_args.get("context")
        return {
            "method": "POST",
            "path": "/api/v1/a2a/send",
            "body": _stable_json(canonical_body),
            "target_agent_did": target_agent,
        }
    if name.startswith("aiv_"):
        return {
            "method": "POST",
            "path": f"mcp/{name}",
            "body": _stable_json(tool_args),
        }
    return None


def _resolve_request_auth_spec(request: httpx.Request) -> dict[str, Any]:
    body = request.content.decode("utf-8") if request.content else ""

    try:
        parsed = json.loads(body)
    except Exception:
        parsed = None

    if isinstance(parsed, dict) and parsed.get("method") == "tools/call":
        params = parsed.get("params")
        if isinstance(params, dict):
            resolved = _resolve_tool_auth_spec(params)
            if resolved:
                return resolved

    return {
        "method": request.method.upper(),
        "path": request.url.path or "/",
        "body": body,
    }


class GovernanceMcpAuth(httpx.Auth):
    def __init__(self) -> None:
        self._session_auth_headers: dict[str, str] | None = None
        self._session_started_ms = 0

    def auth_flow(self, request: httpx.Request):
        auth_spec = _resolve_request_auth_spec(request)
        _log_mcp_debug(
            "sending request",
            {
                "method": auth_spec.get("method"),
                "path": auth_spec.get("path"),
                "target_agent_did": auth_spec.get("target_agent_did"),
            },
        )
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        should_create_session = (
            self._session_auth_headers is None
            or (now_ms - self._session_started_ms) >= MCP_SESSION_TTL_MS
        )
        if should_create_session:
            self._session_auth_headers = build_mcp_session_auth_headers(
                method=str(auth_spec.get("method", "POST")),
                path=str(auth_spec.get("path", "/")),
                body=str(auth_spec.get("body", "")),
                target_agent_did=auth_spec.get("target_agent_did"),
            )
            self._session_started_ms = now_ms
            _log_mcp_debug(
                "mcp auth session established",
                {
                    "method": auth_spec.get("method"),
                    "path": auth_spec.get("path"),
                    "session_ttl_ms": MCP_SESSION_TTL_MS,
                },
            )

        auth_headers = self._session_auth_headers
        for key, value in auth_headers.items():
            request.headers[key] = value
        _log_mcp_debug(
            "auth header attached",
            {
                "mcp_session_reused": not should_create_session,
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
        yield request


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
