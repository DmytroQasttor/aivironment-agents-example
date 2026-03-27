import json
import os
from typing import Literal

from agents import Agent, Runner
from agents.model_settings import ModelSettings
from pydantic import BaseModel, Field

from app.errors import AgentError
from app.openai_mcp import create_governance_mcp_server
from app.validation import validate_ops_audit_input, validate_ops_audit_output


class OpsAuditOutput(BaseModel):
    findings: str
    severity: Literal["low", "medium", "high", "critical"]
    recommendations: list[str]
    controls_passed: int | None = Field(...)


def _get_model() -> str:
    model = os.getenv("OPENAI_MODEL")
    if not isinstance(model, str) or not model:
        raise AgentError("CONFIG_INVALID", "OPENAI_MODEL is required", False, 500)
    return model


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


def _ensure_valid_output(result: dict) -> dict:
    ok_out, errors_out = validate_ops_audit_output(result)
    if not ok_out:
        raise AgentError(
            "OUTPUT_INVALID",
            f"Result failed schema validation: {'; '.join(errors_out)}",
            False,
            500,
        )
    return result


def _build_prompt(task: dict, payload: dict) -> str:
    return "\n".join(
        [
            "Current task context:",
            json.dumps(
                {
                    "task_id": task["task_id"],
                    "intent": task["intent"],
                    "payload": payload,
                    "context": task["context"],
                },
                indent=2,
            ),
            "",
            "Return only the structured output requested by the schema.",
        ]
    )


async def _decide_with_llm(task: dict, payload: dict) -> OpsAuditOutput:
    mcp_server = create_governance_mcp_server()
    async with mcp_server:
        agent = Agent(
            name="Compliance Risk Auditor",
            instructions="\n".join(
                [
                    "You are Compliance Risk Auditor.",
                    "You may use the connected governance MCP server to decide whether to delegate or complete locally.",
                    "Prefer the smallest necessary set of tools and avoid exploratory tool calls unless they are required to complete the task safely.",
                    "Use the route-first governance flow: aiv_get_task_lineage, aiv_list_routes, aiv_get_route_details, then aiv_delegate_task.",
                    "Do not hardcode targets; discover routes via MCP tools and delegate only via active discovered route.",
                    "Depth guardrail: only delegate when context.depth < context.max_depth.",
                ]
            ),
            model=_get_model(),
            model_settings=ModelSettings(max_tokens=_get_max_output_tokens()),
            mcp_servers=[mcp_server],
            output_type=OpsAuditOutput,
        )

        result = await Runner.run(agent, _build_prompt(task, payload))
        final_output = result.final_output_as(OpsAuditOutput, raise_if_incorrect_type=True)
        if final_output is None:
            raise AgentError(
                "EXECUTION_FAILED",
                "LLM run returned no structured output",
                True,
                502,
            )
        return final_output


async def run_ops_audit(task: dict) -> dict:
    payload = task["payload"]
    ok, errors = validate_ops_audit_input(payload)
    if not ok:
        raise AgentError(
            "PAYLOAD_INVALID",
            f"Payload failed schema validation: {'; '.join(errors)}",
            False,
            400,
        )

    llm_result = await _decide_with_llm(task, payload)
    result = llm_result.model_dump(exclude_none=True)
    return _ensure_valid_output(result)
