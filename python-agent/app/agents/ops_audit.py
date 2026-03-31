import json
from typing import Literal

from agents import Agent, Runner
from agents.model_settings import ModelSettings
from pydantic import BaseModel

from app.config import get_openai_max_output_tokens, get_openai_model
from app.errors import AgentError
from app.openai_mcp import create_governance_mcp_server
from app.utils.log import log_mcp_debug
from app.validation import validate_ops_audit_input


# Output schema enforced by the OpenAI Agents SDK structured output feature.
# The SDK guarantees the LLM produces a valid object matching this shape,
# so no additional jsonschema re-validation is needed after the run completes.
class OpsAuditOutput(BaseModel):
    findings: str
    severity: Literal["low", "medium", "high", "critical"]
    recommendations: list[str]
    # Optional — the LLM may omit this field; platform schema does not require it.
    controls_passed: int | None = None


def _build_prompt(task: dict, payload: dict) -> str:
    # The full task context (including routing metadata from `context`) is included
    # so the LLM can apply depth guardrails and access lineage identifiers.
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
    log_mcp_debug("connecting mcp server")
    async with mcp_server:
        log_mcp_debug("mcp server connected")
        agent = Agent(
            name="Compliance Risk Auditor",
            # Agent 03 in the chain: terminal specialist for compliance and risk audit.
            # It should complete locally and return final audit findings.
            # Delegation is only appropriate if multi-hop auditing is explicitly required.
            instructions="\n".join(
                [
                    "You are Compliance Risk Auditor.",
                    "You are the terminal specialist in the chain — your job is to produce final audit findings, not to delegate further.",
                    "Use the connected governance MCP server only if you need task lineage context (aiv_get_task_lineage) to complete the audit.",
                    "Do not delegate unless the task explicitly requires multi-hop auditing.",
                    "Depth guardrail: only delegate when context.depth < context.max_depth.",
                    "Return structured findings with severity, concrete recommendations, and optionally controls_passed.",
                ]
            ),
            model=get_openai_model(),
            model_settings=ModelSettings(max_tokens=get_openai_max_output_tokens()),
            mcp_servers=[mcp_server],
            output_type=OpsAuditOutput,
        )

        try:
            log_mcp_debug(
                "starting agent run",
                {"task_id": task["task_id"], "intent": task["intent"]},
            )
            result = await Runner.run(agent, _build_prompt(task, payload))
            log_mcp_debug(
                "agent run finished",
                {"has_final_output": result.final_output is not None},
            )
        except Exception as exc:
            log_mcp_debug("agent run failed", {"error": str(exc)})
            raise

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
    # llm_result is already validated by the SDK's output_type schema above.
    # Return it directly — no additional jsonschema re-check needed.
    return llm_result.model_dump(exclude_none=True)
