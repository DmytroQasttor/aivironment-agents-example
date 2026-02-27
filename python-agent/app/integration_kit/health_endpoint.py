def build_health_payload(agent_name: str, auth_mode: str) -> dict[str, str]:
    """Minimal `/health` response helper for integration docs."""
    return {
        "status": "ok",
        "agent": agent_name,
        "auth_mode": auth_mode,
    }

