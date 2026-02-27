from typing import Any


def is_connection_forward_request(value: Any) -> bool:
    """Minimal contract check for platform-forwarded /a2a payload."""
    if not isinstance(value, dict):
        return False
    if value.get("type") != "a2a_forward":
        return False
    if not isinstance(value.get("task_id"), str) or not value.get("task_id"):
        return False
    if not isinstance(value.get("intent"), str) or not value.get("intent"):
        return False
    return True

