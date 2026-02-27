import json
import inspect
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse

from app.errors import AgentError
from app.integration_kit.types import is_connection_forward_request


def _build_failure(task_id: str, code: str, message: str, retryable: bool) -> dict[str, Any]:
    return {
        "type": "a2a_response",
        "task_id": task_id,
        "status": "failed",
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
        },
    }


def _build_success(task_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "a2a_response",
        "task_id": task_id,
        "status": "completed",
        "result": result,
    }


def _parse_forward_request(raw_body: bytes) -> dict[str, Any]:
    if not raw_body:
        raise AgentError("PAYLOAD_INVALID", "Expected raw JSON body", False, 400)
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise AgentError("PAYLOAD_INVALID", "Invalid JSON body", False, 400)
    if not is_connection_forward_request(parsed):
        raise AgentError("PAYLOAD_INVALID", "Invalid a2a_forward payload shape", False, 400)
    return parsed


def create_connection_endpoint(
    execute: Callable[[dict[str, Any]], Any],
):
    """
    Minimal `/a2a` endpoint factory for integration docs.
    Does not enforce intent-specific validation.
    """

    async def connection_endpoint(request: Request) -> JSONResponse:
        raw_body = await request.body()
        try:
            parsed = _parse_forward_request(raw_body)
        except Exception as err:
            if isinstance(err, AgentError):
                return JSONResponse(
                    _build_failure("unknown", err.code, err.message, err.retryable),
                    status_code=400,
                )
            return JSONResponse(
                _build_failure(
                    "unknown",
                    "PAYLOAD_INVALID",
                    "Invalid request payload",
                    False,
                ),
                status_code=400,
            )

        try:
            result = execute(parsed)
            if inspect.isawaitable(result):
                result = await result
            return JSONResponse(_build_success(parsed["task_id"], result))
        except Exception as err:
            if isinstance(err, AgentError):
                return JSONResponse(
                    _build_failure(parsed["task_id"], err.code, err.message, err.retryable),
                    status_code=200,
                )
            return JSONResponse(
                _build_failure(
                    parsed["task_id"],
                    "EXECUTION_FAILED",
                    str(err),
                    True,
                ),
                status_code=200,
            )

    return connection_endpoint
