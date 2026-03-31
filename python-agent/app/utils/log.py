import json
import os
from datetime import datetime, timezone
from typing import Any


def _log(level: str, message: str, **fields: Any) -> None:
    payload = {
        "level": level,
        "message": message,
        "ts": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    print(json.dumps(payload, default=str))


def log_info(message: str, **fields: Any) -> None:
    _log("info", message, **fields)


def log_error(message: str, **fields: Any) -> None:
    _log("error", message, **fields)


# MCP debug logging — enable with MCP_DEBUG=1 or MCP_DEBUG=true.
# Logs raw tool call details, session lifecycle, and auth envelope metadata.
def log_mcp_debug(message: str, data: dict[str, Any] | None = None) -> None:
    if os.getenv("MCP_DEBUG", "") not in ("1", "true", "TRUE", "True"):
        return
    if data is None:
        print("[mcp-debug]", message)
        return
    print("[mcp-debug]", message, json.dumps(data, ensure_ascii=False))
