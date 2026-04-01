import json
import os
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from app.agent_runner import run_agent
from app.auth.inbound_auth import verify_inbound_auth
from app.errors import AgentError
from app.integration_kit.health_endpoint import build_health_payload
from app.responses import build_a2a_failure, build_a2a_success
from app.utils.log import log_error, log_info
from app.validation import validate_a2a_forward_envelope


def _inbound_debug_enabled() -> bool:
    value = os.getenv("INBOUND_AUTH_DEBUG", "")
    return value in ("1", "true", "TRUE", "True")


async def health_handler() -> JSONResponse:
    """Lightweight probe endpoint for deploy checks and monitoring."""
    return JSONResponse(
        build_health_payload(
            agent_name="compliance-risk-auditor",
            auth_mode=os.getenv("AGENT_AUTH_MODE", "simple"),
        )
    )


async def a2a_handler(request: Request) -> JSONResponse:
    """Validate platform input, verify platform auth, run the intent, return `a2a_response`."""
    # Keep the exact bytes because inbound JWT body_hash checks use the payload
    # the platform signed, not a re-serialized object.
    raw_body = await request.body()
    if not raw_body:
        return JSONResponse(
            build_a2a_failure(
                "unknown", "PAYLOAD_INVALID", "Expected raw JSON body", False
            ),
            status_code=400,
        )

    try:
        parsed_body: dict[str, Any] = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return JSONResponse(
            build_a2a_failure("unknown", "PAYLOAD_INVALID", "Invalid JSON body", False),
            status_code=400,
        )

    ok, errors = validate_a2a_forward_envelope(parsed_body)
    if not ok:
        return JSONResponse(
            build_a2a_failure(
                "unknown",
                "PAYLOAD_INVALID",
                f"Envelope failed validation: {'; '.join(errors)}",
                False,
            ),
            status_code=400,
        )

    task = parsed_body
    context = task.get("context", {}) if isinstance(task.get("context"), dict) else {}
    correlation_id = (
        context.get("correlation_id")
        if isinstance(context.get("correlation_id"), str) and context.get("correlation_id")
        else task["task_id"]
    )
    depth = context.get("depth") if isinstance(context.get("depth"), (int, float)) else 0
    if _inbound_debug_enabled():
        log_info(
            "Inbound A2A parsed body",
            task_id=task["task_id"],
            correlation_id=correlation_id,
            parsed_body=parsed_body,
            raw_body_utf8=raw_body.decode("utf-8", errors="replace"),
            request_headers=dict(request.headers),
        )
    try:
        # Do not run any business logic until the platform JWT is accepted.
        verify_inbound_auth(
            headers=dict(request.headers),
            raw_body=raw_body,
            task_id=task["task_id"],
            correlation_id=correlation_id,
        )

        log_info(
            "A2A request accepted",
            task_id=task["task_id"],
            correlation_id=correlation_id,
            intent=task["intent"],
            depth=depth,
        )

        result = await run_agent(task)
        return JSONResponse(build_a2a_success(task["task_id"], result))
    except Exception as err:
        # Unexpected runtime failures are normalized into the platform error shape.
        agent_error = (
            err
            if isinstance(err, AgentError)
            else AgentError(
                "EXECUTION_FAILED",
                str(err) if isinstance(err, Exception) else "Unexpected execution error",
                True,
                500,
            )
        )

        log_error(
            "A2A request failed",
            task_id=task["task_id"],
            correlation_id=correlation_id,
            code=agent_error.code,
            error_message=agent_error.message,
        )

        return JSONResponse(
            build_a2a_failure(
                task["task_id"],
                agent_error.code,
                agent_error.message,
                agent_error.retryable,
            ),
            status_code=agent_error.status_code,
        )
