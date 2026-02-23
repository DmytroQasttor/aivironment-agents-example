import json
from typing import Any

from openai import OpenAI

from app.config import require_env
from app.errors import AgentError
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


def run_ops_audit(task: dict[str, Any]) -> dict[str, Any]:
    # Terminal specialist: validates strict input, produces strict output, no delegation.
    payload = task["payload"]
    ok, errors = validate_ops_audit_input(payload)
    if not ok:
        raise AgentError(
            "PAYLOAD_INVALID",
            f"Payload failed schema validation: {'; '.join(errors)}",
            False,
            400,
        )

    prompt = "\n".join(
        [
            "You are Compliance Risk Auditor.",
            "Return only valid JSON with keys:",
            '- findings: string (clear audit narrative, not JSON stringified object)',
            '- severity: one of low|medium|high|critical',
            "- recommendations: array of at least one string",
            "- optional controls_passed: integer >= 0",
            "Respond deterministically using objective/risk/severity context.",
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

    client = _get_openai_client()
    response = client.responses.create(model=_get_model(), input=prompt)
    result = _parse_llm_json(response.output_text)

    ok_out, errors_out = validate_ops_audit_output(result)
    if not ok_out:
        raise AgentError(
            "OUTPUT_INVALID",
            f"Result failed schema validation: {'; '.join(errors_out)}",
            False,
            500,
        )

    return result
