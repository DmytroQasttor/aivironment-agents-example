import json
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


def _parse_json(text: str, error_message: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except Exception:
        raise AgentError("EXECUTION_FAILED", error_message, True, 502)


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
        "description": "Fetch context and lineage details for the current task.",
        "parameters": {
            "type": "object",
            "required": ["task_id", "correlation_id"],
            "properties": {
                "task_id": {"type": "string"},
                "correlation_id": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "list_reachable_routes",
        "description": "List active routes this agent can use for delegation.",
        "parameters": {
            "type": "object",
            "required": ["intent"],
            "properties": {
                "intent": {"type": "string"},
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
            "required": ["connection_slug", "target_agent_did"],
            "properties": {
                "connection_slug": {"type": "string"},
                "target_agent_did": {"type": "string"},
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
                "connection_slug",
                "target_agent_did",
                "intent",
                "payload",
                "context",
            ],
            "properties": {
                "connection_slug": {"type": "string"},
                "target_agent_did": {"type": "string"},
                "intent": {"type": "string"},
                "payload": {"type": "object"},
                "context": {"type": "object"},
            },
            "additionalProperties": False,
        },
    },
]


def _run_tool_call(call: Any) -> Any:
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
    return mcp_call_tool(call.name, args, args.get("target_agent_did"))


def _decide_with_llm(task: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    model = _get_model()
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
    )

    for _ in range(12):
        output = response.output if isinstance(response.output, list) else []
        tool_calls = [item for item in output if getattr(item, "type", None) == "function_call"]
        if not tool_calls:
            break

        tool_outputs: list[dict[str, Any]] = []
        for call in tool_calls:
            result = _run_tool_call(call)
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
