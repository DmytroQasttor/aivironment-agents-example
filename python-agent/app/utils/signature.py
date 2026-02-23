import hashlib
import hmac
from datetime import datetime, timezone


def verify_signature(raw: bytes, signature: str, timestamp: str, secret: str) -> bool:
    if not signature or not timestamp or not secret:
        return False

    try:
        ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age_sec = abs((now - ts).total_seconds())
    except Exception:
        return False

    if age_sec > 300:
        return False

    try:
        body_text = raw.decode("utf-8")
    except Exception:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{body_text}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(f"sha256={expected}", signature)
