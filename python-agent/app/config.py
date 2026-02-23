import os
from dotenv import load_dotenv

from app.errors import AgentError

load_dotenv()


def require_env(name: str, message: str | None = None) -> str:
    value = os.getenv(name)
    if not value:
        raise AgentError("CONFIG_INVALID", message or f"{name} is required", False, 500)
    return value


def get_auth_mode() -> str:
    mode = os.getenv("AGENT_AUTH_MODE", "simple").lower()
    if mode not in ("simple", "advanced"):
        raise AgentError(
            "CONFIG_INVALID",
            "AGENT_AUTH_MODE must be either simple or advanced",
            False,
            500,
        )
    return mode
