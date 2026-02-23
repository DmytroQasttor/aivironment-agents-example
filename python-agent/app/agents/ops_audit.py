import json
from typing import Any

from openai import OpenAI

from app.config import require_env
from app.errors import AgentError
from app.mcp_client import (
    mcp_delegate_task,
    mcp_get_route_details,
    mcp_get_task_context,
    mcp_list_reachable_routes,
)
from app.utils.log import log_info
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


def _parse_llm_json(output_text: str) -> dict[str, Any]:
    try:
        return json.loads(output_text)
    except Exception:
        raise AgentError(
            "EXECUTION_FAILED",
            "LLM output for ops.audit was not valid JSON",
            True,
            502,
        )


def _normalize_route_candidates(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and isinstance(value.get("routes"), list):
        return value["routes"]
    return []


def _pick_active_route(routes: list[dict[str, Any]]) -> dict[str, Any] | None:
    for route in routes:
        if not route.get("connection_slug") or not route.get("target_agent_did"):
            continue
        if isinstance(route.get("active"), bool) and route["active"] is False:
            continue
        return route
    return None


def run_ops_audit(task: dict[str, Any]) -> dict[str, Any]:
    # Terminal by default, but this agent still has full MCP access like real third-party services.
    payload = task["payload"]
    ok, errors = validate_ops_audit_input(payload)
    if not ok:
        raise AgentError(
            "PAYLOAD_INVALID",
            f"Payload failed schema validation: {'; '.join(errors)}",
            False,
            400,
        )

    task_context = mcp_get_task_context(
        task_id=task["task_id"], correlation_id=task["context"]["correlation_id"]
    )
    reachable_routes = _normalize_route_candidates(
        mcp_list_reachable_routes(intent="ops.audit")
    )

    prompt = "\n".join(
        [
            "You are Compliance Risk Auditor.",
            "Return only valid JSON with keys:",
            '- findings: string (clear audit narrative, not JSON stringified object)',
            '- severity: one of low|medium|high|critical',
            "- recommendations: array of at least one string",
            "- optional controls_passed: integer >= 0",
            "- optional delegate: boolean",
            "- optional delegation_reason: string",
            "- optional selected_route: {connection_slug, target_agent_did}",
            "- optional delegate_intent: string",
            "- optional delegate_payload: object",
            "Only delegate if a reachable active route is available and depth allows.",
            "Respond deterministically using objective/risk/severity context.",
            "",
            json.dumps(
                {
                    "task_id": task["task_id"],
                    "intent": task["intent"],
                    "payload": payload,
                    "context": task["context"],
                    "task_context": task_context,
                    "reachable_routes": reachable_routes,
                },
                indent=2,
            ),
        ]
    )

    client = _get_openai_client()
    response = client.responses.create(model=_get_model(), input=prompt)
    llm_result = _parse_llm_json(response.output_text)

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

    ok_out, errors_out = validate_ops_audit_output(result)
    if not ok_out:
        raise AgentError(
            "OUTPUT_INVALID",
            f"Result failed schema validation: {'; '.join(errors_out)}",
            False,
            500,
        )

    can_delegate = task["context"]["depth"] < task["context"]["max_depth"]
    wants_delegate = llm_result.get("delegate") is True
    if not (can_delegate and wants_delegate):
        return result

    preferred_route = llm_result.get("selected_route")
    selected_route = None
    if isinstance(preferred_route, dict):
        for route in reachable_routes:
            if (
                route.get("connection_slug") == preferred_route.get("connection_slug")
                and route.get("target_agent_did")
                == preferred_route.get("target_agent_did")
            ):
                selected_route = route
                break
    if selected_route is None:
        selected_route = _pick_active_route(reachable_routes)
    if selected_route is None:
        log_info(
            "LLM requested delegation but no active route was available",
            task_id=task["task_id"],
            correlation_id=task["context"]["correlation_id"],
        )
        return result

    mcp_get_route_details(
        connection_slug=selected_route["connection_slug"],
        target_agent_did=selected_route["target_agent_did"],
    )
    delegate_intent = (
        llm_result.get("delegate_intent")
        if isinstance(llm_result.get("delegate_intent"), str)
        else "ops.audit"
    )
    delegate_payload = (
        llm_result.get("delegate_payload")
        if isinstance(llm_result.get("delegate_payload"), dict)
        else payload
    )
    mcp_delegate_task(
        connection_slug=selected_route["connection_slug"],
        target_agent_did=selected_route["target_agent_did"],
        intent=delegate_intent,
        payload=delegate_payload,
        context={
            "correlation_id": task["context"]["correlation_id"],
            "parent_task_id": task["task_id"],
            "depth": task["context"]["depth"] + 1,
            "max_depth": task["context"]["max_depth"],
        },
    )
    result["recommendations"] = [
        *result["recommendations"],
        f"Delegated follow-up to {selected_route['target_agent_did']} via {selected_route['connection_slug']}",
    ]
    return result
