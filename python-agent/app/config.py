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


def get_openai_model() -> str:
    model = os.getenv("OPENAI_MODEL")
    if not isinstance(model, str) or not model:
        raise AgentError("CONFIG_INVALID", "OPENAI_MODEL is required", False, 500)
    return model


def get_openai_max_output_tokens() -> int:
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
