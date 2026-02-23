def build_a2a_success(task_id: str, result: dict) -> dict:
    return {
        "type": "a2a_response",
        "task_id": task_id,
        "status": "completed",
        "result": result,
    }


def build_a2a_failure(
    task_id: str, code: str, message: str, retryable: bool
) -> dict:
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
