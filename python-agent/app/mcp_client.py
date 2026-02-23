import json
from itertools import count
from typing import Any
from urllib.parse import urlparse

import httpx

from app.auth.outbound_auth import build_outbound_auth_headers
from app.config import require_env
from app.errors import AgentError

_rpc_ids = count(1)


def _json_rpc_request(
    method: str, params: dict[str, Any], target_agent_did: str | None = None
) -> Any:
    mcp_url = require_env("MCP_HTTP_URL", "MCP_HTTP_URL is required")
    body = json.dumps(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": next(_rpc_ids)}
    )
    path = urlparse(mcp_url).path or "/"
    auth_headers = build_outbound_auth_headers(
        method="POST", path=path, body=body, target_agent_did=target_agent_did
    )

    try:
        response = httpx.post(
            mcp_url,
            headers={"Content-Type": "application/json", **auth_headers},
            content=body,
            timeout=20.0,
        )
    except Exception as err:
        raise AgentError("MCP_UNAVAILABLE", f"MCP request failed: {err}", True, 503)

    if response.status_code >= 400:
        raise AgentError(
            "MCP_UNAVAILABLE",
            f"MCP HTTP {response.status_code}: {response.text}",
            True,
            503,
        )

    data = response.json()
    if data.get("error"):
        error = data["error"]
        raise AgentError(
            "MCP_TOOL_FAILED",
            f"MCP error {error.get('code')}: {error.get('message')}",
            True,
            502,
        )
    if "result" not in data:
        raise AgentError("MCP_TOOL_FAILED", "MCP response missing result", True, 502)
    return data["result"]


def mcp_call_tool(
    name: str, args: dict[str, Any], target_agent_did: str | None = None
) -> Any:
    return _json_rpc_request(
        "tools/call", {"name": name, "args": args}, target_agent_did=target_agent_did
    )


def mcp_get_task_context(task_id: str, correlation_id: str) -> Any:
    return mcp_call_tool(
        "get_task_context", {"task_id": task_id, "correlation_id": correlation_id}
    )


def mcp_list_reachable_routes(intent: str) -> Any:
    return mcp_call_tool("list_reachable_routes", {"intent": intent})


def mcp_get_route_details(connection_slug: str, target_agent_did: str) -> Any:
    return mcp_call_tool(
        "get_route_details",
        {
            "connection_slug": connection_slug,
            "target_agent_did": target_agent_did,
        },
    )


def mcp_delegate_task(
    connection_slug: str,
    target_agent_did: str,
    intent: str,
    payload: dict[str, Any],
    context: dict[str, Any],
) -> Any:
    return mcp_call_tool(
        "delegate_task",
        {
            "connection_slug": connection_slug,
            "target_agent_did": target_agent_did,
            "intent": intent,
            "payload": payload,
            "context": context,
        },
        target_agent_did=target_agent_did,
    )
