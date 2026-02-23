import json
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
