import json
import os
from itertools import count
from typing import Any
from urllib.parse import urlparse

import httpx

from app.auth.outbound_auth import build_outbound_auth_headers
from app.config import require_env
from app.errors import AgentError

_rpc_ids = count(1)
_session_id: str | None = None
_initialized = False


def _get_agent_secret_for_mcp_tools() -> str:
    agent_secret = os.getenv("AGENT_SECRET") or os.getenv("AGENT_API_KEY")
    if not isinstance(agent_secret, str) or not agent_secret:
        raise AgentError(
            "CONFIG_INVALID",
            "AGENT_SECRET or AGENT_API_KEY is required for simple governance MCP auth",
            False,
            500,
        )
    return agent_secret


def _parse_sse_json_frames(raw_text: str) -> list[dict[str, Any]]:
    """Parse JSON-RPC SSE `data:` frames emitted by MCP stream endpoint."""
    responses: list[dict[str, Any]] = []
    for line in raw_text.splitlines():
        trimmed = line.strip()
        if not trimmed.startswith("data:"):
            continue
        payload = trimmed[len("data:") :].strip()
        if not payload:
            continue
        try:
            parsed = json.loads(payload)
        except Exception:
            continue
        if isinstance(parsed, dict):
            responses.append(parsed)
    return responses


def _strip_governance_auth_fields(tool_args: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in tool_args.items()
        if key
        not in {
            "agent_secret",
            "agent_did",
            "timestamp_header",
            "signature_header",
            "algorithm_header",
        }
    }


def _pick_rpc_response(responses: list[dict[str, Any]], request_id: int) -> dict[str, Any] | None:
    """Select response by id when available, else first result/error frame."""
    for response in responses:
        if response.get("id") == request_id:
            return response
    for response in responses:
        if "result" in response or "error" in response:
            return response
    return None


def _resolve_tool_auth_spec(params: dict[str, Any]) -> dict[str, Any] | None:
    """Map tool call to logical method/path/body used for advanced auth signing."""
    name = params.get("name")
    tool_args = params.get("arguments")
    if not isinstance(name, str) or not isinstance(tool_args, dict):
        return None

    if name == "list_reachable_routes":
        return {"method": "GET", "path": "/api/v1/runtime/routes", "body": ""}
    if name == "get_route_details":
        slug = tool_args.get("slug")
        if not isinstance(slug, str) or not slug:
            return None
        return {
            "method": "GET",
            "path": f"/api/v1/runtime/routes/{slug}",
            "body": "",
        }
    if name == "get_task_context":
        task_id = tool_args.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            return None
        return {
            "method": "GET",
            "path": f"/api/v1/runtime/task-context/{task_id}",
            "body": "",
        }
    if name == "delegate_task":
        target_agent = tool_args.get("target_agent")
        if not isinstance(target_agent, str) or not target_agent:
            return None
        context_value = tool_args.get("context")
        include_context = isinstance(context_value, dict)
        canonical_body: dict[str, Any] = {
            "target_agent": target_agent,
            "intent": tool_args.get("intent"),
            "payload": tool_args.get("payload"),
            **({"context": context_value} if include_context else {}),
            "connection": tool_args.get("connection"),
        }
        return {
            "method": "POST",
            "path": "/api/v1/a2a/send",
            "body": json.dumps(
                canonical_body,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ),
            "target_agent_did": target_agent,
        }
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
        context_value = tool_args.get("context")
        include_context = isinstance(context_value, dict)
        canonical_body: dict[str, Any] = {
            "target_agent": target_agent,
            "intent": tool_args.get("intent"),
            "payload": tool_args.get("payload"),
            **({"context": context_value} if include_context else {}),
            "connection": tool_args.get("connection"),
        }
        return {
            "method": "POST",
            "path": "/api/v1/a2a/send",
            "body": json.dumps(
                canonical_body,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ),
            "target_agent_did": target_agent,
        }
    if name.startswith("aiv_"):
        return {
            "method": "POST",
            "path": f"mcp/{name}",
            "body": json.dumps(
                _strip_governance_auth_fields(tool_args),
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ),
        }
    return None


def _with_governance_tool_identity(params: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(params.get("arguments"), dict):
        return params
    name = params.get("name")
    if not isinstance(name, str) or not name.startswith("aiv_"):
        return params
    return {
        **params,
        "arguments": {
            **params["arguments"],
            "agent_did": require_env("AGENT_DID", "AGENT_DID is required"),
            **(
                {"agent_secret": _get_agent_secret_for_mcp_tools()}
                if os.getenv("AGENT_AUTH_MODE", "simple").lower() == "simple"
                else {}
            ),
        },
    }


def _with_tool_auth_arguments(params: dict[str, Any]) -> dict[str, Any]:
    """Inject auth fields expected by the governance MCP tool contract."""
    with_identity = _with_governance_tool_identity(params)
    if not isinstance(with_identity.get("arguments"), dict):
        return with_identity
    spec = _resolve_tool_auth_spec(with_identity)
    if not spec:
        return with_identity

    auth_headers = build_outbound_auth_headers(
        method=spec["method"],
        path=spec["path"],
        body=spec["body"],
        target_agent_did=spec.get("target_agent_did"),
    )
    return {
        **with_identity,
        "arguments": {
            **with_identity["arguments"],
            **(
                {"timestamp_header": auth_headers["X-Timestamp"]}
                if isinstance(auth_headers.get("X-Timestamp"), str)
                else {}
            ),
            **(
                {"signature_header": auth_headers["X-Signature"]}
                if isinstance(auth_headers.get("X-Signature"), str)
                else {}
            ),
            **(
                {"algorithm_header": auth_headers["X-Signature-Algorithm"]}
                if isinstance(auth_headers.get("X-Signature-Algorithm"), str)
                else {}
            ),
        },
    }


def _post_rpc(
    method: str, params: dict[str, Any], target_agent_did: str | None = None
) -> Any:
    """Send a single JSON-RPC request over MCP stream transport."""
    global _session_id

    mcp_url = require_env("MCP_HTTP_URL", "MCP_HTTP_URL is required")
    request_id = next(_rpc_ids)
    resolved_params: dict[str, Any] = (
        _with_tool_auth_arguments(params) if method == "tools/call" else params
    )
    body = json.dumps(
        {"jsonrpc": "2.0", "method": method, "params": resolved_params, "id": request_id}
    )
    path = urlparse(mcp_url).path or "/"
    auth_headers = build_outbound_auth_headers(
        method="POST", path=path, body=body, target_agent_did=target_agent_did
    )

    headers: dict[str, str] = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        **auth_headers,
    }
    if _session_id:
        headers["mcp-session-id"] = _session_id

    try:
        response = httpx.post(
            mcp_url,
            headers=headers,
            content=body,
            timeout=20.0,
        )
    except Exception as err:
        raise AgentError("MCP_UNAVAILABLE", f"MCP request failed: {err}", True, 503)

    response_session_id = response.headers.get("mcp-session-id")
    if isinstance(response_session_id, str) and response_session_id:
        _session_id = response_session_id

    if response.status_code >= 400:
        raise AgentError(
            "MCP_UNAVAILABLE",
            f"MCP HTTP {response.status_code}: {response.text}",
            True,
            503,
        )

    rpc_frames = _parse_sse_json_frames(response.text)
    rpc_response = _pick_rpc_response(rpc_frames, request_id)
    if not rpc_response:
        raise AgentError(
            "MCP_TOOL_FAILED",
            "MCP stream response missing JSON-RPC frame",
            True,
            502,
        )

    if isinstance(rpc_response.get("error"), dict):
        error = rpc_response["error"]
        raise AgentError(
            "MCP_TOOL_FAILED",
            f"MCP error {error.get('code')}: {error.get('message')}",
            True,
            502,
        )

    return rpc_response.get("result")


def _ensure_initialized() -> None:
    """Initialize MCP session once per process."""
    global _initialized
    if _initialized:
        return

    init_result = _post_rpc(
        "initialize",
        {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "aivironment-python-agent",
                "version": "1.0.0",
            },
        },
    )
    if not isinstance(init_result, dict):
        raise AgentError("MCP_UNAVAILABLE", "MCP initialize returned invalid result", True, 503)
    _initialized = True


def mcp_call_tool(
    name: str, args: dict[str, Any], target_agent_did: str | None = None
) -> Any:
    """Generic tool invoker used by intent handlers."""
    _ensure_initialized()
    result = _post_rpc(
        "tools/call", {"name": name, "arguments": args}, target_agent_did
    )
    if result is None:
        raise AgentError("MCP_TOOL_FAILED", "MCP response missing result", True, 502)
    return result


def mcp_get_task_context(task_id: str, correlation_id: str) -> Any:
    return mcp_call_tool(
        "aiv_get_task_lineage", {"task_id": task_id, "correlation_id": correlation_id}
    )


def mcp_list_reachable_routes(task_id: str) -> Any:
    return mcp_call_tool("aiv_list_routes", {"task_id": task_id})


def mcp_get_route_details(task_id: str, slug: str) -> Any:
    return mcp_call_tool("aiv_get_route_details", {"task_id": task_id, "slug": slug})


def mcp_delegate_task(
    task_id: str,
    connection: str,
    target_agent_did: str,
    intent: str,
    payload: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> Any:
    """Helper for delegation tool with target DID forwarded for advanced auth."""
    return mcp_call_tool(
        "aiv_delegate_task",
        {
            "task_id": task_id,
            "connection": connection,
            "target_agent": target_agent_did,
            "intent": intent,
            "payload": payload,
            **({"context": context} if isinstance(context, dict) else {}),
        },
        target_agent_did=target_agent_did,
    )
