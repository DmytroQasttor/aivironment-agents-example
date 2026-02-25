import json
import os
from typing import Any

from openai import OpenAI

from app.config import require_env
from app.errors import AgentError
from app.mcp_client import mcp_call_tool
from app.validation import validate_ops_audit_input, validate_ops_audit_output

_openai_client: OpenAI | None = None


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = require_env("OPENAI_API_KEY", "OPENAI_API_KEY is required")
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client


def _get_model() -> str:
    return require_env("OPENAI_MODEL", "OPENAI_MODEL is required")


def _get_max_output_tokens() -> int:
    raw = os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "1200")
    try:
        parsed = int(raw)
    except Exception:
        raise AgentError(
            "CONFIG_INVALID",
            "OPENAI_MAX_OUTPUT_TOKENS must be a positive integer",
            False,
            500,
        )
    if parsed <= 0:
        raise AgentError(
            "CONFIG_INVALID",
            "OPENAI_MAX_OUTPUT_TOKENS must be a positive integer",
            False,
            500,
        )
    return parsed


def _parse_json(text: str, error_message: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except Exception:
        raise AgentError("EXECUTION_FAILED", error_message, True, 502)


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _is_uuid(value: str) -> bool:
    import re

    return (
        isinstance(value, str)
        and re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            value,
            re.IGNORECASE,
        )
        is not None
    )


def _extract_connection_id(route_details: Any) -> str | None:
    if not isinstance(route_details, dict):
        return None
    for key in ("connection", "connection_id", "id"):
        candidate = route_details.get(key)
        if isinstance(candidate, str) and _is_uuid(candidate):
            return candidate
    nested = route_details.get("route")
    if isinstance(nested, dict):
        for key in ("connection", "connection_id", "id"):
            candidate = nested.get(key)
            if isinstance(candidate, str) and _is_uuid(candidate):
                return candidate
    return None


def _ensure_valid_output(result: dict[str, Any]) -> dict[str, Any]:
    ok_out, errors_out = validate_ops_audit_output(result)
    if not ok_out:
        raise AgentError(
            "OUTPUT_INVALID",
            f"Result failed schema validation: {'; '.join(errors_out)}",
            False,
            500,
        )
    return result


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_task_context",
        "description": "Fetch context and lineage details for the current task id.",
        "parameters": {
            "type": "object",
            "required": [],
            "properties": {
                "max_parent_depth": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "list_reachable_routes",
        "description": "List active routes this agent can use for delegation from current task.",
        "parameters": {
            "type": "object",
            "required": [],
            "properties": {
                "page": {"type": "number"},
                "per_page": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "get_route_details",
        "description": "Get details and schema expectations for a selected route.",
        "parameters": {
            "type": "object",
            "required": ["slug"],
            "properties": {
                "slug": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "delegate_task",
        "description": (
            "Delegate to a target agent. Use only with discovered active routes and correct lineage context."
        ),
        "parameters": {
            "type": "object",
            "required": [
                "connection",
                "target_agent_did",
                "intent",
                "payload",
            ],
            "properties": {
                "connection": {"type": "string"},
                "target_agent_did": {"type": "string"},
                "intent": {"type": "string"},
                "payload": {"type": "object"},
                "context": {"type": "object"},
            },
            "additionalProperties": False,
        },
    },
]


def _run_tool_call(call: Any, request_task_id: str) -> Any:
    args = _parse_json(
        call.arguments if isinstance(call.arguments, str) else "{}",
        "Model produced invalid tool arguments",
    )
    if call.name not in {
        "get_task_context",
        "list_reachable_routes",
        "get_route_details",
        "delegate_task",
    }:
        raise AgentError(
            "EXECUTION_FAILED",
            f"Unsupported tool requested: {call.name}",
            False,
            400,
        )

    if call.name == "get_task_context":
        tool_args = {"task_id": request_task_id}
        if isinstance(args.get("max_parent_depth"), (int, float)):
            tool_args["max_parent_depth"] = args["max_parent_depth"]
        return mcp_call_tool("get_task_context", tool_args)

    if call.name == "list_reachable_routes":
        tool_args = {"task_id": request_task_id}
        if isinstance(args.get("page"), (int, float)):
            tool_args["page"] = args["page"]
        if isinstance(args.get("per_page"), (int, float)):
            tool_args["per_page"] = args["per_page"]
        return mcp_call_tool("list_reachable_routes", tool_args)

    if call.name == "get_route_details":
        slug = args.get("slug") or args.get("connection_slug")
        if not isinstance(slug, str) or not slug:
            raise AgentError(
                "EXECUTION_FAILED",
                "Model must provide route slug for get_route_details",
                True,
                502,
            )
        return mcp_call_tool("get_route_details", {"task_id": request_task_id, "slug": slug})

    connection = args.get("connection") or args.get("connection_slug")
    target_agent_did = args.get("target_agent_did")
    if not isinstance(connection, str) or not isinstance(target_agent_did, str):
        raise AgentError(
            "EXECUTION_FAILED",
            "Model must provide connection and target_agent_did for delegate_task",
            True,
            502,
        )
    route_details: Any = None
    resolved_connection = connection
    if not _is_uuid(connection):
        route_details = mcp_call_tool(
            "get_route_details", {"task_id": request_task_id, "slug": connection}
        )
        extracted = _extract_connection_id(route_details)
        if isinstance(extracted, str):
            resolved_connection = extracted
    if not _is_plain_object(args.get("payload")):
        if route_details is None and not _is_uuid(connection):
            route_details = mcp_call_tool(
                "get_route_details", {"task_id": request_task_id, "slug": connection}
            )
        return {
            "error": {
                "code": "TOOL_ARGUMENTS_INVALID",
                "message": (
                    "delegate_task requires payload as a JSON object matching selected "
                    "route intent schema"
                ),
            },
            "route_details": route_details,
        }

    delegate_args: dict[str, Any] = {
        "task_id": request_task_id,
        "connection": resolved_connection,
        "target_agent": target_agent_did,
        "intent": args.get("intent"),
        "payload": args.get("payload"),
    }
    if isinstance(args.get("context"), dict):
        delegate_args["context"] = args["context"]
    return mcp_call_tool("delegate_task", delegate_args, target_agent_did)


def _decide_with_llm(task: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    model = _get_model()
    max_output_tokens = _get_max_output_tokens()
    client = _get_openai_client()
    initial_prompt = "\n".join(
        [
            "You are Compliance Risk Auditor.",
            "You may use MCP tools to decide whether to delegate or complete locally.",
            "Do not hardcode targets; discover routes via tools and delegate only via active discovered route.",
            "Depth guardrail: only delegate when context.depth < context.max_depth.",
            "When finished, respond with JSON object only:",
            (
                '{ "findings": string, "severity": "low|medium|high|critical", '
                '"recommendations": string[], "controls_passed"?: number }'
            ),
            "",
            json.dumps(
                {
                    "task_id": task["task_id"],
                    "intent": task["intent"],
                    "payload": payload,
                    "context": task["context"],
                },
                indent=2,
            ),
        ]
    )

    response = client.responses.create(
        model=model,
        input=initial_prompt,
        tools=TOOL_DEFINITIONS,
        max_output_tokens=max_output_tokens,
    )

    for _ in range(12):
        output = response.output if isinstance(response.output, list) else []
        tool_calls = [item for item in output if getattr(item, "type", None) == "function_call"]
        if not tool_calls:
            break

        tool_outputs: list[dict[str, Any]] = []
        for call in tool_calls:
            try:
                result = _run_tool_call(call, task["task_id"])
            except Exception as err:
                result = {
                    "error": {
                        "code": "TOOL_EXECUTION_FAILED",
                        "message": str(err),
                    }
                }
            tool_outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": call.call_id,
                    "output": json.dumps(result),
                }
            )

        response = client.responses.create(
            model=model,
            previous_response_id=response.id,
            input=tool_outputs,
            tools=TOOL_DEFINITIONS,
            max_output_tokens=max_output_tokens,
        )

    return _parse_json(
        response.output_text,
        "LLM final output for ops.audit was not valid JSON",
    )


def run_ops_audit(task: dict[str, Any]) -> dict[str, Any]:
    payload = task["payload"]
    ok, errors = validate_ops_audit_input(payload)
    if not ok:
        raise AgentError(
            "PAYLOAD_INVALID",
            f"Payload failed schema validation: {'; '.join(errors)}",
            False,
            400,
        )

    llm_result = _decide_with_llm(task, payload)
    result = {
        "findings": llm_result.get("findings"),
        "severity": llm_result.get("severity"),
        "recommendations": llm_result.get("recommendations"),
        **(
            {"controls_passed": llm_result["controls_passed"]}
            if "controls_passed" in llm_result
            else {}
        ),
    }
    return _ensure_valid_output(result)
